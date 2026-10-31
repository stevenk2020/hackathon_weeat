import { createKeyPool, KeyError, keyTag, parseKeys } from './goongKeys.mjs';

export class GeoError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

const goong = createKeyPool(parseKeys(process.env.GOONG_API_KEY));
const tiles = createKeyPool(parseKeys(process.env.GOONG_MAPTILES_KEY));
const vietmapKey = process.env.VIETMAP_SERVICES_KEY || '';
const goongBase = process.env.GOONG_API_BASE_URL || 'https://rsapi.goong.io';
const goongVersion = process.env.GOONG_API_VERSION || 'v2';
const DAY = 86_400_000;
const caches = { search: new Map(), place: new Map(), reverse: new Map(), route: new Map() };
const refLabels = new Map();
const usage = new Map();
const fold = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase().trim().replace(/\s+/g, ' ');
const validQuery = value => typeof value === 'string' && value.trim().length <= 120;
const coordinate = (value, limit) => value !== null && value !== '' && value !== undefined && Number.isFinite(Number(value)) && Math.abs(Number(value)) <= limit;
const validPoint = (lat, lng) => coordinate(lat, 90) && coordinate(lng, 180);
const point = (lat, lng) => {
  if (!validPoint(lat, lng)) throw new GeoError(400, 'invalid_coordinates', 'Invalid coordinates.');
  return { latitude: Number(lat), longitude: Number(lng) };
};
const routePath = path => goongVersion === 'v2' ? `/v2/${path}` : `/${path}`;

function cached(cache, key, work) {
  const old = cache.get(key);
  if (old && old.expires > Date.now()) return old.value;
  const pending = Promise.resolve().then(work).then(value => {
    cache.set(key, { value: Promise.resolve(value), expires: Date.now() +
      (value === null || Array.isArray(value) && !value.length ? 600_000 : DAY) });
    return value;
  }).catch(error => { cache.delete(key); throw error; });
  cache.set(key, { value: pending, expires: Date.now() + 15_000 });
  return pending;
}

async function providerJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(8_000) });
  if ([401, 403, 429].includes(response.status)) throw new KeyError(`HTTP ${response.status}`);
  if (!response.ok) throw new GeoError(response.status >= 500 ? 502 : response.status,
    'geo_provider_error', 'Address provider could not answer.');
  const data = await response.json();
  if (data?.status === 'OVER_QUERY_LIMIT' || data?.status === 'REQUEST_DENIED')
    throw new KeyError(String(data.status), data.status === 'OVER_QUERY_LIMIT' ? 60_000 : 3_600_000);
  return data;
}

async function fromGoong(path, params) {
  if (!goong.size) throw new GeoError(503, 'geo_unavailable', 'Goong is not configured.');
  return goong.run(key => {
    const url = new URL(path, goongBase);
    for (const [name, value] of Object.entries(params)) if (value !== undefined && value !== '') url.searchParams.set(name, String(value));
    url.searchParams.set('api_key', key);
    return providerJson(url);
  });
}

async function fromVietmap(path, params) {
  if (!vietmapKey) throw new GeoError(503, 'geo_unavailable', 'VietMap is not configured.');
  const url = new URL(path, 'https://maps.vietmap.vn');
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, String(value));
  url.searchParams.set('apikey', vietmapKey);
  const response = await fetch(url, { signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new GeoError(502, 'geo_provider_error', 'Address provider could not answer.');
  return response.json();
}

async function withFallback(goongWork, vietmapWork, hasValue = value => Boolean(value)) {
  try {
    const result = await goongWork();
    if (hasValue(result)) return result;
  } catch { /* VietMap is the configured fallback. */ }
  try { return await vietmapWork(); }
  catch { throw new GeoError(503, 'geo_unavailable', 'Address lookup is unavailable.'); }
}

export function checkGeoRate(uid) {
  const now = Date.now();
  const times = (usage.get(String(uid)) || []).filter(time => now - time < 60_000);
  if (times.length >= 40) throw new GeoError(429, 'geo_rate_limited', 'Too many address lookups.');
  times.push(now);
  usage.set(String(uid), times);
}

export async function suggestAddresses(query, sessionToken = '') {
  if (!validQuery(query)) throw new GeoError(400, 'bad_request', 'Invalid address search.');
  const q = query.trim();
  if (q.length < (/[0-9]/.test(q) ? 3 : 4)) return [];
  if (sessionToken && (typeof sessionToken !== 'string' || sessionToken.length > 100 || !/^[\w-]+$/.test(sessionToken)))
    throw new GeoError(400, 'bad_request', 'Invalid search session.');
  const rows = await cached(caches.search, fold(q), () => withFallback(
    async () => {
      const data = await fromGoong(routePath('place/autocomplete'), { input: q, sessiontoken: sessionToken, limit: 10 });
      return (data.predictions || []).slice(0, 10).map(row => ({ id: String(row.place_id),
        ref: `goong:${encodeURIComponent(row.place_id)}`, label: String(row.description || row.structured_formatting?.main_text || '') }))
        .filter(row => row.id && row.label);
    },
    async () => {
      const data = await fromVietmap('/api/autocomplete/v4', { text: q, display_type: 2 });
      return (Array.isArray(data) ? data : []).slice(0, 10).map(row => ({ id: String(row.ref_id),
        ref: `vietmap:${encodeURIComponent(row.ref_id)}`, label: String(row.display || '') }))
        .filter(row => row.id && row.label);
    },
    rows => rows.length > 0));
  for (const row of rows) refLabels.set(row.ref, row.label);
  return rows;
}

export async function resolveAddress(ref, sessionToken = '') {
  if (typeof ref !== 'string' || ref.length > 700 || !/^(goong|vietmap):[^:]+/.test(ref))
    throw new GeoError(400, 'bad_request', 'Invalid place reference.');
  const split = ref.indexOf(':');
  const source = ref.slice(0, split);
  let id;
  try { id = decodeURIComponent(ref.slice(split + 1)); } catch { throw new GeoError(400, 'bad_request', 'Invalid place reference.'); }
  if (!id) throw new GeoError(400, 'bad_request', 'Invalid place reference.');
  if (sessionToken && (typeof sessionToken !== 'string' || sessionToken.length > 100 || !/^[\w-]+$/.test(sessionToken)))
    throw new GeoError(400, 'bad_request', 'Invalid search session.');
  return cached(caches.place, ref, async () => {
    let row, provider = source;
    if (source === 'goong') {
      try {
        const data = await fromGoong(routePath('place/detail'), { place_id: id, sessiontoken: sessionToken });
        row = { label: data.result?.formatted_address || data.result?.name,
          lat: data.result?.geometry?.location?.lat, lng: data.result?.geometry?.location?.lng };
      } catch {
        const label = refLabels.get(ref);
        if (!label) throw new GeoError(503, 'geo_unavailable', 'Address lookup is unavailable.');
        const suggestions = await fromVietmap('/api/autocomplete/v4', { text: label, display_type: 2 });
        const fallbackRef = Array.isArray(suggestions) && suggestions[0]?.ref_id;
        if (!fallbackRef) throw new GeoError(404, 'not_found', 'Address not found.');
        const fallback = await fromVietmap('/api/place/v4', { refid: fallbackRef });
        row = { label: fallback.display || label, lat: fallback.lat, lng: fallback.lng };
        provider = 'vietmap';
      }
    } else {
      const data = await fromVietmap('/api/place/v4', { refid: id });
      const value = Array.isArray(data) ? data[0] : data;
      row = { label: value?.display || value?.name, lat: value?.lat, lng: value?.lng };
    }
    if (!row.label || !validPoint(row.lat, row.lng))
      throw new GeoError(404, 'not_found', 'Address not found.');
    return { id: ref, ref, label: String(row.label), ...point(row.lat, row.lng), provider };
  });
}

export async function reverseGeocode(lat, lng) {
  const coords = point(lat, lng);
  const key = `${coords.latitude.toFixed(4)},${coords.longitude.toFixed(4)}`;
  return cached(caches.reverse, key, () => withFallback(
    async () => {
      const data = await fromGoong(routePath('geocode'), { latlng: `${coords.latitude},${coords.longitude}`, limit: 1 });
      const label = data.results?.[0]?.formatted_address;
      return label ? { id: `gps:${key}`, label, ...coords, provider: 'goong' } : null;
    },
    async () => {
      const data = await fromVietmap('/api/reverse/v4', { lat: coords.latitude, lng: coords.longitude, display_type: 2 });
      const label = (Array.isArray(data) ? data[0] : data)?.display;
      return label ? { id: `gps:${key}`, label, ...coords, provider: 'vietmap' } : null;
    }));
}

export async function routeBetween(fromLat, fromLng, toLat, toLng) {
  const from = point(fromLat, fromLng);
  const to = point(toLat, toLng);
  const key = `${from.latitude.toFixed(5)},${from.longitude.toFixed(5)}:${to.latitude.toFixed(5)},${to.longitude.toFixed(5)}`;
  return cached(caches.route, key, async () => {
    const data = await fromGoong(routePath('direction'), { origin: `${from.latitude},${from.longitude}`,
      destination: `${to.latitude},${to.longitude}`, vehicle: 'bike' });
    const route = data.routes?.[0];
    const polyline = route?.overview_polyline?.points;
    const distance_m = route?.legs?.reduce((sum, leg) => sum + Number(leg.distance?.value || 0), 0);
    const duration_s = route?.legs?.reduce((sum, leg) => sum + Number(leg.duration?.value || 0), 0);
    if (typeof polyline !== 'string' || !polyline) throw new GeoError(502, 'route_unavailable', 'No route was returned.');
    return { polyline, distance_m, duration_s };
  });
}

export async function mapConfig(failed = '') {
  if (!tiles.size) throw new GeoError(503, 'map_unavailable', 'Map tiles are not configured.');
  if (failed) {
    if (!/^[A-Za-z0-9]{4}$/.test(failed)) throw new GeoError(400, 'bad_request', 'Invalid tile key tag.');
    const tag = `…${failed}`;
    const refused = tiles.keyByTag(tag);
    if (refused) {
      try {
        const probe = await fetch(`https://tiles.goong.io/assets/goong_map_web.json?api_key=${encodeURIComponent(refused)}`,
          { signal: AbortSignal.timeout(5_000) });
        if ([401, 403, 429].includes(probe.status)) tiles.restByTag(tag, `HTTP ${probe.status}`,
          probe.status === 429 ? 60_000 : 3_600_000);
      } catch { /* A network failure does not prove that the key is bad. */ }
    }
  }
  const key = tiles.acquire();
  if (!key) throw new GeoError(503, 'map_unavailable', 'Map tiles are unavailable.');
  return { style_url: `https://tiles.goong.io/assets/goong_map_web.json?api_key=${encodeURIComponent(key)}`,
    key_tag: key.slice(-4) };
}
