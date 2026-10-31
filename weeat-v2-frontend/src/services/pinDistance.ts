import { distanceKm, type LatLng } from './mapGeometry';

export function getPinDistanceLabel(
  pin: { key: string; lat: number; lng: number },
  from: LatLng | null | undefined,
  destinationKey: string | null | undefined,
  route: { distanceM: number } | null | undefined,
): string | null {
  if (!from) return null;
  if (pin.key === destinationKey && route && Number.isFinite(route.distanceM) && route.distanceM >= 0) {
    return `${(route.distanceM / 1000).toFixed(1)} km`;
  }
  return `~${distanceKm(from, [pin.lat, pin.lng]).toFixed(1)} km`;
}
