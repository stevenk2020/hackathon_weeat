/** Geographic coordinates throughout this module are [latitude, longitude]. */
export type LatLng = [number, number];
type LngLat = [number, number];

const METRES_PER_DEGREE_LAT = 110_574;
const METRES_PER_DEGREE_LNG = 111_320;
const RADIANS = Math.PI / 180;

type Frame = { centre: LatLng; metresPerDegreeLng: number };

function frame(centre: LatLng): Frame {
  return { centre, metresPerDegreeLng: METRES_PER_DEGREE_LNG * Math.cos(centre[0] * RADIANS) };
}

function project(point: LatLng, local: Frame): [number, number] {
  return [
    (point[1] - local.centre[1]) * local.metresPerDegreeLng,
    (point[0] - local.centre[0]) * METRES_PER_DEGREE_LAT,
  ];
}

function unproject(x: number, y: number, local: Frame): LatLng {
  return [
    local.centre[0] + y / METRES_PER_DEGREE_LAT,
    local.centre[1] + x / local.metresPerDegreeLng,
  ];
}

function midpoint(a: LatLng, b: LatLng): LatLng {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

export function distanceKm(a: LatLng, b: LatLng): number {
  const local = frame(midpoint(a, b));
  const [x, y] = project(b, local);
  const [ax, ay] = project(a, local);
  return Math.hypot(x - ax, y - ay) / 1000;
}

export function distanceToPolylineKm(lat: number, lng: number, line: LatLng[]): number {
  if (line.length === 0) return Infinity;
  const local = frame([lat, lng]);
  const points = line.map(point => project(point, local));
  let nearest = Infinity;
  for (let i = 0; i < points.length; i++) {
    const [ax, ay] = points[i];
    if (i === points.length - 1) {
      nearest = Math.min(nearest, Math.hypot(ax, ay));
      break;
    }
    const [bx, by] = points[i + 1];
    const dx = bx - ax, dy = by - ay;
    const fraction = dx * dx + dy * dy === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy)));
    nearest = Math.min(nearest, Math.hypot(ax + fraction * dx, ay + fraction * dy));
  }
  return nearest / 1000;
}

export function decodePolyline(encoded: string): LatLng[] {
  const points: LatLng[] = [];
  let lat = 0, lng = 0, index = 0;
  const read = (): number => {
    let shift = 0, result = 0, byte: number;
    do {
      if (index >= encoded.length) throw new Error('Invalid encoded polyline');
      byte = encoded.charCodeAt(index++) - 63;
      result += (byte & 0x1f) * 2 ** shift;
      shift += 5;
    } while (byte >= 0x20);
    return result & 1 ? -(Math.floor(result / 2) + 1) : Math.floor(result / 2);
  };
  while (index < encoded.length) {
    lat += read();
    lng += read();
    points.push([lat / 1e5, lng / 1e5]);
  }
  return points;
}

export function circleRing(lat: number, lng: number, radiusKm: number, steps = 72): LngLat[] {
  const local = frame([lat, lng]);
  const ring: LngLat[] = [];
  for (let i = 0; i < steps; i++) {
    const angle = 2 * Math.PI * i / steps;
    const [pointLat, pointLng] = unproject(Math.sin(angle) * radiusKm * 1000, Math.cos(angle) * radiusKm * 1000, local);
    ring.push([pointLng, pointLat]);
  }
  if (ring.length) ring.push([...ring[0]] as LngLat);
  return ring;
}

export function boundsOf(points: LatLng[]): [number, number, number, number] | null {
  if (points.length === 0) return null;
  let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
  for (const [lat, lng] of points) {
    west = Math.min(west, lng);
    south = Math.min(south, lat);
    east = Math.max(east, lng);
    north = Math.max(north, lat);
  }
  return [west, south, east, north];
}

export function buildEllipse(a: LatLng, b: LatLng | undefined, radiusKm: number, steps = 90): {
  polygon: { type: 'Polygon'; coordinates: LngLat[][] };
  center: LatLng;
  a: number;
  b: number;
  angle: number;
} {
  const centre = b ? midpoint(a, b) : a;
  const local = frame(centre);
  const [ax, ay] = project(a, local);
  const [bx, by] = b ? project(b, local) : [ax, ay];
  const focusDistance = Math.hypot(bx - ax, by - ay) / 1000;
  const halfFocus = focusDistance < 0.001 ? 0 : focusDistance / 2;
  const semiMajor = halfFocus + radiusKm;
  const semiMinor = Math.sqrt(Math.max(0, semiMajor ** 2 - halfFocus ** 2));
  const angle = halfFocus ? Math.atan2(by - ay, bx - ax) : 0;
  const ring: LngLat[] = [];
  for (let i = 0; i < steps; i++) {
    const theta = 2 * Math.PI * i / steps;
    const along = semiMajor * Math.cos(theta) * 1000;
    const across = semiMinor * Math.sin(theta) * 1000;
    const x = along * Math.cos(angle) - across * Math.sin(angle);
    const y = along * Math.sin(angle) + across * Math.cos(angle);
    const [lat, lng] = unproject(x, y, local);
    ring.push([lng, lat]);
  }
  if (ring.length) ring.push([...ring[0]] as LngLat);
  return { polygon: { type: 'Polygon', coordinates: [ring] }, center: centre, a: semiMajor, b: semiMinor, angle };
}

export function isInsideEllipse(point: LatLng, a: LatLng, b: LatLng | undefined, radiusKm: number): boolean {
  if (!b || distanceKm(a, b) < 0.001) {
    const [x, y] = project(point, frame(a));
    return Math.hypot(x, y) <= radiusKm * 1000;
  }
  const local = frame(midpoint(a, b));
  const [px, py] = project(point, local);
  const [ax, ay] = project(a, local);
  const [bx, by] = project(b, local);
  return Math.hypot(px - ax, py - ay) + Math.hypot(px - bx, py - by) <= Math.hypot(ax - bx, ay - by) + 2 * radiusKm * 1000;
}
