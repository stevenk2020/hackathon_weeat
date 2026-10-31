import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { config } from './config.mjs';
import { pool, query } from './db.mjs';
import { syncIndexSafe } from './placeIndex.mjs';

export class HttpError extends Error {
  constructor(status, code, message, headers = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.headers = headers;
  }
}

const invalidUrl = () => { throw new HttpError(400, 'invalid_url', 'Enter a TikTok video or YouTube Shorts link.'); };
const stableId = (...parts) => createHash('md5').update(parts.map(String).join('\0')).digest('hex');
const text = value => typeof value === 'string' && value.trim() ? value.trim() : null;
const date = value => value ? new Date(value).toISOString() : '';

export function canonicalUrl(input) {
  if (typeof input !== 'string') invalidUrl();
  let link;
  try { link = new URL(input.trim()); } catch { invalidUrl(); }
  if (link.protocol !== 'https:' || link.username || link.password || link.port) invalidUrl();
  const host = link.hostname.toLowerCase();
  if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be', 'www.youtu.be'].includes(host)) {
    const match = host.endsWith('youtu.be')
      ? link.pathname.match(/^\/([A-Za-z0-9_-]{11})\/?$/)
      : link.pathname.match(/^\/shorts\/([A-Za-z0-9_-]{11})\/?$/);
    if (!match) invalidUrl();
    return { url: `https://www.youtube.com/shorts/${match[1]}`, youtubeId: match[1] };
  }
  const short = host === 'vt.tiktok.com' || host === 'vm.tiktok.com';
  const tiktok = ['tiktok.com', 'www.tiktok.com', 'm.tiktok.com'].includes(host);
  if (!short && !tiktok) invalidUrl();
  if (short ? !/^\/[A-Za-z0-9]+\/?$/.test(link.pathname)
    : !/^\/@[^/]+\/(?:video|photo)\/\d+\/?$/.test(link.pathname) &&
      !(host === 'm.tiktok.com' && /^\/v\/\d+\.html\/?$/.test(link.pathname))) invalidUrl();
  link.search = '';
  link.hash = '';
  return { url: link.href, youtubeId: null };
}

export function coverFile(name) {
  return typeof name === 'string' && /^tiktok-\d+\.(?:jpg|jpeg|png|webp)$/i.test(name) ? name : null;
}

function thumbnail(value) {
  if (!text(value)) return null;
  try {
    const url = new URL(value);
    if (url.pathname.startsWith('/covers/') &&
        coverFile(url.pathname.slice('/covers/'.length))) return url.pathname;
  } catch { /* A relative cover path is handled below. */ }
  if (value.startsWith('/covers/') && coverFile(value.slice('/covers/'.length))) return value;
  return value;
}

function comments(value, videoId) {
  if (!text(value)) return undefined;
  const result = [];
  for (const [index, part] of value.split(/\s+\/\s+/).entries()) {
    const match = part.match(/^\[(positive|negative|mixed|neutral)\]\s*\((\d+)\s+likes?\)\s*(.+)$/i);
    if (match) result.push({
      id: `${videoId}-${index}`, text: match[3].trim(),
      sentiment: match[1].toLowerCase() === 'positive' ? 'good' : match[1].toLowerCase() === 'negative' ? 'negative' : 'neutral',
      likes: Number(match[2]),
    });
  }
  return result;
}

function storeUrl(value) {
  if (!text(value)) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && (url.hostname === 'shopeefood.vn' || url.hostname.endsWith('.shopeefood.vn')) &&
      url.pathname !== '/' ? url.href : null;
  } catch { return null; }
}

export function toRestaurant(row) {
  const store = storeUrl(row.shopeefood_url);
  const result = {
    ...row,
    restaurant_name: row.restaurant_name || '',
    dish: row.dish || '',
    address: row.address || row.address_text || row.location || '',
    price_vnd: row.price_vnd ?? null,
    price_vnd_max: row.price_vnd_max ?? null,
    cate_id: row.cate_id ?? 14,
    latitude: row.latitude ?? null,
    longitude: row.longitude ?? null,
    is_saved: row.is_saved ? 1 : 0,
    shopeefood_kinds: store ? 'store' : text(row.shopeefood_search_url) ? 'search' : null,
    shopeefood_url: store,
    thumbnail_url: thumbnail(row.thumbnail_url),
    user_note: row.user_note || '',
    create_time: date(row.create_time),
    update_time: date(row.update_time),
    video_url: row.video_url || row.url || '',
    script_text: row.script_text ?? null,
  };
  const parsed = comments(row.comments_text, row.video_id);
  if (parsed !== undefined) result.comments = parsed;
  return result;
}

function toVideo(row) {
  return {
    video_id: row.video_id,
    platform: row.platform,
    video_url: row.video_url || row.url,
    thumbnail_url: thumbnail(row.thumbnail_url),
    title: row.title || '',
    script_text: row.script_text ?? null,
    duration_seconds: row.duration_seconds ?? null,
    is_food_beverage: true,
  };
}

const idFrom = link => link.youtubeId || link.url.match(/\/(?:video|photo)\/(\d+)\/?$/)?.[1] || null;
const platformFrom = link => link.youtubeId ? 'youtube' : 'tiktok';

async function findVideo(link, uid) {
  const result = await query(`SELECT user_id, video_id, platform FROM public.quan_hackathon_video_places
    WHERE platform = $1 AND (url = $2 OR shared_url = $2 OR video_url = $2 OR ($3::text IS NOT NULL AND video_id = $3))
    ORDER BY (user_id = $4) DESC, create_time DESC LIMIT 1`, [platformFrom(link), link.url, idFrom(link), uid]);
  return result.rows[0] || null;
}

async function videoRows(uid, videoId, platform) {
  const result = await query(`SELECT * FROM public.quan_hackathon_video_places
    WHERE user_id = $1 AND video_id = $2 AND platform = $3
    ORDER BY place_index NULLS LAST, create_time, restaurant_id`, [uid, videoId, platform]);
  return result.rows;
}

function analysis(rows, source) {
  return { video: toVideo(rows[0]), restaurants: rows.map(toRestaurant), source };
}

async function insertRow(row, execute) {
  const columns = Object.keys(row);
  const names = columns.map(name => `"${name.replaceAll('"', '""')}"`).join(', ');
  const values = columns.map(name => row[name]);
  const slots = columns.map((_, index) => `$${index + 1}`).join(', ');
  await execute(`INSERT INTO public.quan_hackathon_video_places (${names}) VALUES (${slots})
    ON CONFLICT (user_id, video_id, restaurant_id) DO NOTHING`, values);
}

async function insertRows(rows) {
  if (!rows.length) return;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const row of rows) await insertRow(row, client.query.bind(client));
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function copyVideo(sourceRows, uid) {
  const now = new Date();
  await insertRows(sourceRows.map(source => ({
    ...source, user_id: uid, doc_id: stableId(uid, source.video_id, source.restaurant_id),
    is_saved: false, user_note: null, create_time: now, update_time: now, synced_at: now,
    has_conflict: Boolean(source.has_conflict), incomplete: Boolean(source.incomplete),
  })));
}

function crawlRow(place, video, link, uid, index) {
  if (!place || typeof place !== 'object' || Array.isArray(place))
    throw new HttpError(502, 'upstream_error', 'The video service returned an invalid restaurant.');
  const display = place.display || {};
  const source = place.source || {};
  const videoId = text(video.video_id) || idFrom(link);
  if (!videoId) throw new HttpError(502, 'upstream_error', 'The video service did not identify the video.');
  const restaurantId = text(place.restaurant_id) || text(place.id) ||
    stableId(videoId, display.name || place.restaurant_name || '', display.location || place.address_text || '', index);
  const now = new Date();
  return {
    user_id: uid, video_id: videoId, restaurant_id: restaurantId,
    doc_id: stableId(uid, videoId, restaurantId),
    cate_id: place.cate_id ?? 14,
    thumbnail_url: place.thumbnail_url || video.thumbnail_url || source.thumbnail || null,
    create_time: now, update_time: now, url: link.url, place_index: index + 1,
    platform: video.platform || platformFrom(link), media: video.media || 'video',
    video_url: video.video_url || source.videoUrl || link.url, shared_url: link.url,
    title: video.title || null, channel: video.channel || source.channel || null,
    script_text: video.script_text || null, comments_text: video.comments_text || null,
    restaurant_name: display.name || place.restaurant_name || null,
    dish: display.dish || place.dish || null,
    location: display.location || place.location || null,
    address: place.address || display.location || null,
    address_text: place.address_text || null,
    price: display.price || null, price_text: place.price_text || display.price || null,
    price_vnd: place.price_vnd ?? null, price_vnd_max: place.price_vnd_max ?? null,
    latitude: place.latitude ?? null, longitude: place.longitude ?? null,
    geo_source: place.geoSource || place.geo_source || null,
    maps_url: place.mapsSearchUrl || place.maps_url || null,
    shopeefood_url: place.shopeeFoodUrl || place.shopeefood_url || null,
    shopeefood_search_url: place.shopeeFoodSearchUrl || place.shopeefood_search_url || null,
    has_conflict: Boolean(place.hasConflict ?? place.has_conflict),
    incomplete: Boolean(place.incomplete ?? place.missingFields?.length),
    ai_extracted_unverified: true, is_saved: false, user_note: null,
  };
}

async function crawl(link, user) {
  let response;
  try {
    response = await fetch(new URL('/api/extract', config.crawlBaseUrl), {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.crawlApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: link.url, email: user.email }),
      signal: AbortSignal.timeout(150_000),
    });
  } catch (error) {
    if (error?.name === 'TimeoutError') throw new HttpError(504, 'timeout', 'The video service timed out.');
    throw new HttpError(502, 'upstream_unreachable', 'The video service is unavailable.');
  }
  let data;
  try { data = await response.json(); } catch { throw new HttpError(502, 'upstream_error', 'The video service returned an invalid response.'); }
  if (!response.ok) {
    const code = data?.error?.code;
    const message = data?.error?.message || 'The video could not be analyzed.';
    if (code === 'invalid_url') throw new HttpError(400, 'invalid_url', message);
    if (code === 'video_unavailable') throw new HttpError(404, code, message);
    if (code === 'video_too_long') throw new HttpError(422, 'VIDEO_TOO_LONG', message);
    if (['nothing_to_read', 'video_not_analyzable', 'photo_caption_unavailable'].includes(code))
      throw new HttpError(422, 'NOT_FOOD_BEVERAGE', message);
    if (['rate_limited', 'live_limit'].includes(code))
      throw new HttpError(429, code, message, { 'Retry-After': response.headers.get('retry-after') || '60' });
    if (['ai_busy', 'youtube_quota'].includes(code)) throw new HttpError(503, code, message);
    throw new HttpError(502, 'upstream_error', message);
  }
  if (!data || !Array.isArray(data.places) || !data.row || typeof data.row !== 'object')
    throw new HttpError(502, 'upstream_error', 'The video service returned an invalid response.');
  return data;
}

export async function analyze(user, rawUrl) {
  const link = canonicalUrl(rawUrl);
  const found = await findVideo(link, user.uid);
  if (found) {
    if (String(found.user_id) !== String(user.uid)) {
      const sourceRows = await videoRows(found.user_id, found.video_id, found.platform);
      await copyVideo(sourceRows, user.uid);
      await syncIndexSafe(user.uid, found.video_id);
    }
    const rows = await videoRows(user.uid, found.video_id, found.platform);
    if (rows.length) return analysis(rows, 'database');
  }
  const result = await crawl(link, user);
  await insertRows(result.places.map((place, index) => crawlRow(place, result.row, link, user.uid, index)));
  await syncIndexSafe(user.uid);
  const videoId = text(result.row.video_id) || idFrom(link);
  const rows = videoId ? await videoRows(user.uid, videoId, result.row.platform || platformFrom(link)) : [];
  return rows.length ? analysis(rows, 'crawl') : {
    video: toVideo({ ...result.row, video_id: videoId, platform: result.row.platform || platformFrom(link), url: link.url }),
    restaurants: [], source: 'crawl',
  };
}

export async function savePlace(uid, videoId, restaurantId, saved) {
  const result = await query(`UPDATE public.quan_hackathon_video_places SET is_saved = $4
    WHERE user_id = $1 AND video_id = $2 AND restaurant_id = $3 RETURNING is_saved`,
  [uid, videoId, restaurantId, saved]);
  if (!result.rows.length) throw new HttpError(404, 'not_found', 'Restaurant not found.');
  await syncIndexSafe(uid, videoId, restaurantId);
  return { is_saved: result.rows[0].is_saved ? 1 : 0 };
}

export async function editPlace(uid, videoId, restaurantId, edits) {
  if (!edits || typeof edits !== 'object' || Array.isArray(edits))
    throw new HttpError(400, 'bad_request', 'Invalid restaurant edits.');
  const limits = { restaurant_name: 120, dish: 200, address: 240, user_note: 500 };
  const addressMeta = new Set(['latitude', 'longitude', 'geo_source']);
  const allowed = new Set([...Object.keys(limits), 'price_vnd', 'price_vnd_max', ...addressMeta]);
  const supplied = Object.keys(edits);
  if (!supplied.length || supplied.some(field => !allowed.has(field)))
    throw new HttpError(400, 'bad_request', 'Unsupported restaurant edit.');
  const fields = supplied.filter(field => !addressMeta.has(field));
  for (const [field, limit] of Object.entries(limits)) {
    if (!(field in edits)) continue;
    if (typeof edits[field] !== 'string' || edits[field].length > limit ||
        (field !== 'user_note' && !edits[field].trim()))
      throw new HttpError(400, 'bad_request', `Invalid ${field}.`);
    if (field !== 'user_note') edits[field] = edits[field].trim();
  }
  for (const field of ['price_vnd', 'price_vnd_max']) {
    if (field in edits && edits[field] !== null &&
        (!Number.isSafeInteger(edits[field]) || edits[field] < 0))
      throw new HttpError(400, 'bad_request', `Invalid ${field}.`);
  }
  const current = await query(`SELECT price_vnd, price_vnd_max, address FROM public.quan_hackathon_video_places
    WHERE user_id = $1 AND video_id = $2 AND restaurant_id = $3 AND is_saved = true`, [uid, videoId, restaurantId]);
  if (!current.rows.length) throw new HttpError(404, 'not_found', 'Saved restaurant not found.');
  const changedAddress = 'address' in edits && edits.address !== current.rows[0].address;
  if (changedAddress) {
    if (typeof edits.latitude !== 'number' || !Number.isFinite(edits.latitude) || Math.abs(edits.latitude) > 90 ||
        typeof edits.longitude !== 'number' || !Number.isFinite(edits.longitude) || Math.abs(edits.longitude) > 180 ||
        !['goong', 'vietmap'].includes(edits.geo_source))
      throw new HttpError(400, 'bad_request', 'Choose an address from the map lookup.');
  } else if (supplied.some(field => addressMeta.has(field))) {
    throw new HttpError(400, 'bad_request', 'Coordinates require a changed address.');
  }
  const min = 'price_vnd' in edits ? edits.price_vnd : current.rows[0].price_vnd;
  const max = 'price_vnd_max' in edits ? edits.price_vnd_max : current.rows[0].price_vnd_max;
  if (min !== null && max !== null && Number(max) < Number(min))
    throw new HttpError(400, 'bad_request', 'Maximum price must be at least minimum price.');
  const values = fields.map(field => edits[field]);
  const assignments = fields.map((field, index) => `${field} = $${index + 4}`);
  if (changedAddress) {
    assignments.push('address_text = $' + (values.length + 4), 'location = $' + (values.length + 4));
    values.push(edits.address);
    assignments.push('latitude = $' + (values.length + 4));
    values.push(edits.latitude);
    assignments.push('longitude = $' + (values.length + 4));
    values.push(edits.longitude);
    assignments.push('geo_source = $' + (values.length + 4));
    values.push(`${edits.geo_source}_address`);
    assignments.push('maps_url = $' + (values.length + 4));
    values.push(`https://www.google.com/maps/search/?api=1&query=${edits.latitude},${edits.longitude}`);
  }
  const result = await query(`UPDATE public.quan_hackathon_video_places
    SET ${assignments.join(', ')}, update_time = now()
    WHERE user_id = $1 AND video_id = $2 AND restaurant_id = $3 AND is_saved = true
    RETURNING *`, [uid, videoId, restaurantId, ...values]);
  if (!result.rows.length) throw new HttpError(404, 'not_found', 'Saved restaurant not found.');
  await syncIndexSafe(uid, videoId, restaurantId);
  return { restaurant: toRestaurant(result.rows[0]) };
}

export async function savedPlaces(uid, q = '', cateId = null) {
  const search = q.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase().trim();
  const result = await query(`SELECT * FROM public.quan_hackathon_video_places
    WHERE user_id = $1 AND is_saved = true AND ($2::int IS NULL OR cate_id = $2)
    ORDER BY create_time DESC NULLS LAST, video_id, restaurant_id`, [uid, cateId]);
  const rows = result.rows.filter(row => typeof row.restaurant_name === 'string' && row.restaurant_name.trim()).map(toRestaurant);
  return { restaurants: search ? rows.filter(row => [row.restaurant_name, row.dish, row.address]
    .join(' ').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase().includes(search)) : rows };
}

export async function samples() {
  const result = await query(`SELECT latest.*, (SELECT COUNT(DISTINCT restaurant_id)::int
      FROM public.quan_hackathon_video_places p2 WHERE p2.video_id = latest.video_id AND p2.platform = latest.platform) AS place_count
    FROM (SELECT DISTINCT ON (platform, video_id) video_id, platform, video_url, url, title, thumbnail_url, create_time
      FROM public.quan_hackathon_video_places WHERE platform IN ('tiktok', 'youtube')
      ORDER BY platform, video_id, create_time DESC) latest
    ORDER BY latest.create_time DESC LIMIT 2`);
  return { videos: result.rows.map(row => ({ ...toVideo(row), place_count: row.place_count })) };
}

export async function serveCover(res, name, head = false) {
  if (!coverFile(name)) throw new HttpError(404, 'not_found', 'Cover not found.');
  let upstream;
  try {
    upstream = await fetch(new URL(`/covers/${name}`, config.crawlBaseUrl), { signal: AbortSignal.timeout(10_000) });
  } catch { throw new HttpError(502, 'upstream_unreachable', 'Cover service is unavailable.'); }
  if (upstream.status === 404) {
    res.writeHead(302, { Location: '/images/pho-scene.jpg', 'Cache-Control': 'public, max-age=3600' });
    res.end();
    return;
  }
  if (!upstream.ok) throw new HttpError(502, 'upstream_error', 'Cover service is unavailable.');
  const kind = upstream.headers.get('content-type') || '';
  if (!kind.startsWith('image/')) throw new HttpError(502, 'upstream_error', 'Invalid cover response.');
  res.writeHead(200, { 'Content-Type': kind, 'Cache-Control': 'public, max-age=86400' });
  if (head) { res.end(); return; }
  await pipeline(Readable.fromWeb(upstream.body), res);
}
