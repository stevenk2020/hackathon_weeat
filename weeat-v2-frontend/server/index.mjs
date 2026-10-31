import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, missingConfig, originFor } from './config.mjs';
import { pool, query } from './db.mjs';
import { cookie, readCookie, seal, unseal } from './session.mjs';
import { HttpError, analyze, editPlace, savePlace, savedPlaces, samples, serveCover } from './places.mjs';
import { GeoError, checkGeoRate, mapConfig, resolveAddress, reverseGeocode, routeBetween, suggestAddresses } from './geo.mjs';

const dist = resolve(fileURLToPath(new URL('../dist/', import.meta.url)));
const SESSION = 'weeat_session';
const OAUTH = 'weeat_oauth';
const SESSION_SECONDS = 7 * 24 * 60 * 60;

const sendJson = (res, status, data, headers = {}) => {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(body);
};

const redirect = (res, location, headers = {}) => {
  res.writeHead(302, { Location: location, 'Cache-Control': 'no-store', ...headers });
  res.end();
};

function sessionUser(req) {
  const data = unseal(readCookie(req, SESSION));
  if (!data || !/^[0-9]+$/.test(String(data.uid)) || typeof data.email !== 'string') return null;
  return { uid: String(data.uid), email: data.email };
}

function requireUser(req) {
  const user = sessionUser(req);
  if (!user) throw new HttpError(401, 'unauthorized', 'Please sign in to continue.');
  return user;
}

async function jsonBody(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 65_536) throw new HttpError(413, 'request_too_large', 'Request body is too large.');
  }
  if (!body) return {};
  try {
    const value = JSON.parse(body);
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  } catch { /* reported below */ }
  throw new HttpError(400, 'bad_request', 'Expected a JSON object.');
}

function profile(row) {
  return {
    user_id: row.user_id,
    user_email: row.user_email,
    user_name: row.user_name || '',
    user_address: row.user_address || '',
    user_lat: row.user_lat,
    user_long: row.user_long,
    age: row.age,
    food_interests: row.food_interests || [],
    food_notes: row.food_notes || '',
    budget: 'any',
  };
}

async function getProfile(uid) {
  const result = await query(`SELECT user_id, user_email, user_name, user_address, user_lat, user_long,
      age, food_interests, food_notes FROM public.user_dim WHERE user_id = $1`, [uid]);
  if (!result.rows[0]) throw new HttpError(404, 'not_found', 'Profile not found.');
  return profile(result.rows[0]);
}

async function patchProfile(uid, input) {
  const allowed = new Set(['user_name', 'user_address', 'user_lat', 'user_long', 'age', 'food_interests', 'food_notes']);
  if (Object.keys(input).some(key => !allowed.has(key))) throw new HttpError(400, 'bad_request', 'Unsupported profile field.');
  if ('user_name' in input && (typeof input.user_name !== 'string' || input.user_name.length > 80))
    throw new HttpError(400, 'bad_request', 'Invalid display name.');
  if ('age' in input && input.age !== null && (!Number.isInteger(input.age) || input.age < 5 || input.age > 120))
    throw new HttpError(400, 'bad_request', 'Invalid age.');
  if ('food_interests' in input && (!Array.isArray(input.food_interests) || input.food_interests.some(item => typeof item !== 'string')))
    throw new HttpError(400, 'bad_request', 'Invalid food interests.');
  if ('food_notes' in input && (typeof input.food_notes !== 'string' || input.food_notes.length > 2000))
    throw new HttpError(400, 'bad_request', 'Invalid food notes.');

  const homeFields = ['user_address', 'user_lat', 'user_long'];
  if (homeFields.some(key => key in input)) {
    if (typeof input.user_address !== 'string' || !input.user_address.trim() || input.user_address.length > 240 ||
        typeof input.user_lat !== 'number' || !Number.isFinite(input.user_lat) || Math.abs(input.user_lat) > 90 ||
        typeof input.user_long !== 'number' || !Number.isFinite(input.user_long) || Math.abs(input.user_long) > 180)
      throw new HttpError(400, 'bad_request', 'Choose a home address with coordinates.');
    input.user_address = input.user_address.trim();
  }

  const fields = Object.keys(input);
  if (fields.length === 0) return getProfile(uid);
  const values = fields.map(key => input[key]);
  const assignments = fields.map((key, index) => `${key} = $${index + 2}`).join(', ');
  const result = await query(`UPDATE public.user_dim SET ${assignments}, updated_at = now() WHERE user_id = $1
    RETURNING user_id, user_email, user_name, user_address, user_lat, user_long, age, food_interests, food_notes`, [uid, ...values]);
  if (!result.rows[0]) throw new HttpError(404, 'not_found', 'Profile not found.');
  return profile(result.rows[0]);
}

async function verifyGoogleIdToken(idToken, nonce) {
  const url = new URL('https://oauth2.googleapis.com/tokeninfo');
  url.searchParams.set('id_token', idToken);
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new HttpError(401, 'google_invalid', 'Google sign-in could not be verified.');
  const claims = await response.json();
  const issuer = claims.iss === 'accounts.google.com' || claims.iss === 'https://accounts.google.com';
  if (!issuer || claims.aud !== config.googleClientId || Number(claims.exp) <= Date.now() / 1000 ||
      claims.nonce !== nonce || !claims.sub || !(claims.email_verified === true || claims.email_verified === 'true') ||
      typeof claims.email !== 'string' || !claims.email.includes('@'))
    throw new HttpError(401, 'google_invalid', 'Google sign-in could not be verified.');
  return claims;
}

async function googleCallback(req, res, url, origin) {
  const secure = origin.startsWith('https:');
  const clear = cookie(OAUTH, '', { maxAge: 0, secure });
  const pending = unseal(readCookie(req, OAUTH));
  if (url.searchParams.has('error') || !pending || !pending.state || !pending.nonce ||
      url.searchParams.get('state') !== pending.state || !url.searchParams.get('code')) {
    redirect(res, '/?auth_error=google_failed', { 'Set-Cookie': clear });
    return;
  }
  try {
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: url.searchParams.get('code'),
        client_id: config.googleClientId,
        client_secret: config.googleClientSecret,
        redirect_uri: `${origin}/api/auth/google/callback`,
        grant_type: 'authorization_code',
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!tokenResponse.ok) throw new HttpError(401, 'google_invalid', 'Google sign-in failed.');
    const tokens = await tokenResponse.json();
    if (typeof tokens.id_token !== 'string') throw new HttpError(401, 'google_invalid', 'Google sign-in failed.');
    const claims = await verifyGoogleIdToken(tokens.id_token, pending.nonce);
    const email = claims.email.toLowerCase();
    const user = await query(`INSERT INTO public.user_dim (user_email, user_name) VALUES ($1, $2)
      ON CONFLICT (lower(user_email)) DO UPDATE SET user_email = user_dim.user_email
      RETURNING user_id, user_email`, [email, typeof claims.name === 'string' ? claims.name : null]);
    const session = seal({ uid: String(user.rows[0].user_id), email: user.rows[0].user_email }, SESSION_SECONDS);
    redirect(res, '/', { 'Set-Cookie': [clear, cookie(SESSION, session, { maxAge: SESSION_SECONDS, secure })] });
  } catch (error) {
    console.error('Google sign-in failed:', error?.code || error?.name || 'unknown');
    redirect(res, '/?auth_error=google_failed', { 'Set-Cookie': clear });
  }
}

const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.ico': 'image/x-icon',
};

async function serveStatic(res, pathname, head = false) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { throw new HttpError(400, 'bad_request', 'Invalid path.'); }
  const target = resolve(dist, `.${decoded}`);
  if (target !== dist && !target.startsWith(dist + sep)) throw new HttpError(404, 'not_found', 'Not found.');
  let file = target;
  try {
    if (!(await stat(file)).isFile()) file = resolve(dist, 'index.html');
  } catch {
    if (extname(decoded)) throw new HttpError(404, 'not_found', 'Not found.');
    file = resolve(dist, 'index.html');
  }
  let bytes;
  try { bytes = await readFile(file); } catch { throw new HttpError(404, 'not_found', 'App build not found.'); }
  res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'Content-Length': bytes.length });
  res.end(head ? undefined : bytes);
}

async function handle(req, res) {
  const origin = originFor(req);
  const url = new URL(req.url || '/', origin);
  const path = url.pathname;
  const method = req.method || 'GET';
  if (!['GET', 'HEAD'].includes(method) && req.headers.origin && req.headers.origin !== origin)
    throw new HttpError(403, 'cross_origin', 'Cross-origin writes are not allowed.');

  if (path === '/api/health' && method === 'GET') return sendJson(res, 200, { ok: true });
  if (path === '/api/auth/me' && method === 'GET') return sendJson(res, 200, { user: sessionUser(req) });
  if (path === '/api/auth/logout' && method === 'POST') {
    return sendJson(res, 200, { ok: true }, { 'Set-Cookie': cookie(SESSION, '', { maxAge: 0, secure: origin.startsWith('https:') }) });
  }
  if (path === '/api/auth/google/start' && method === 'GET') {
    const state = randomBytes(24).toString('base64url');
    const nonce = randomBytes(24).toString('base64url');
    const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    auth.search = new URLSearchParams({ response_type: 'code', client_id: config.googleClientId,
      redirect_uri: `${origin}/api/auth/google/callback`, scope: 'openid email profile', state, nonce }).toString();
    return redirect(res, auth.href, { 'Set-Cookie': cookie(OAUTH, seal({ state, nonce }, 600), { maxAge: 600, secure: origin.startsWith('https:') }) });
  }
  if (path === '/api/auth/google/callback' && method === 'GET') return googleCallback(req, res, url, origin);
  if (path === '/api/categories' && method === 'GET') {
    const rows = await query('SELECT cate_id, cate_name_vn, cate_name_en FROM public.cate_dim ORDER BY cate_id');
    return sendJson(res, 200, { categories: rows.rows });
  }
  if (path === '/api/geo/search' && method === 'GET') {
    const user = requireUser(req);
    checkGeoRate(user.uid);
    return sendJson(res, 200, { suggestions: await suggestAddresses(url.searchParams.get('q') || '', url.searchParams.get('st') || '') });
  }
  if (path === '/api/geo/place' && method === 'GET') {
    const user = requireUser(req);
    checkGeoRate(user.uid);
    return sendJson(res, 200, { address: await resolveAddress(url.searchParams.get('ref') || '', url.searchParams.get('st') || '') });
  }
  if (path === '/api/geo/reverse' && method === 'GET') {
    const user = requireUser(req);
    checkGeoRate(user.uid);
    return sendJson(res, 200, { address: await reverseGeocode(url.searchParams.get('lat'), url.searchParams.get('lng')) });
  }
  if (path === '/api/map/config' && method === 'GET') {
    requireUser(req);
    return sendJson(res, 200, await mapConfig(url.searchParams.get('failed') || ''));
  }
  if (path === '/api/map/route' && method === 'GET') {
    requireUser(req);
    return sendJson(res, 200, await routeBetween(url.searchParams.get('from_lat'), url.searchParams.get('from_lng'),
      url.searchParams.get('to_lat'), url.searchParams.get('to_lng')));
  }
  if (path === '/api/profile' && method === 'GET') return sendJson(res, 200, { profile: await getProfile(requireUser(req).uid) });
  if (path === '/api/profile' && method === 'PATCH') {
    const user = requireUser(req);
    return sendJson(res, 200, { profile: await patchProfile(user.uid, await jsonBody(req)) });
  }
  if (path === '/api/analyze' && method === 'POST') {
    const user = requireUser(req);
    const result = await analyze(user, (await jsonBody(req)).url);
    return sendJson(res, 200, { video: result.video, restaurants: result.restaurants }, { 'X-Weeat-Source': result.source });
  }
  if (path === '/api/samples' && method === 'GET') return sendJson(res, 200, await samples());
  if (path === '/api/library' && method === 'GET') {
    const cateRaw = url.searchParams.get('cate_id');
    const cateId = cateRaw === null ? null : Number(cateRaw);
    if (cateRaw !== null && (!Number.isInteger(cateId) || cateId < 1))
      throw new HttpError(400, 'bad_request', 'Invalid category.');
    const q = url.searchParams.get('q') || '';
    if (q.length > 200) throw new HttpError(400, 'bad_request', 'Search is too long.');
    return sendJson(res, 200, await savedPlaces(requireUser(req).uid, q, cateId));
  }
  const save = path.match(/^\/api\/library\/([^/]+)\/([^/]+)\/save$/);
  if (save && (method === 'PUT' || method === 'DELETE')) {
    const user = requireUser(req);
    let videoId, restaurantId;
    try { videoId = decodeURIComponent(save[1]); restaurantId = decodeURIComponent(save[2]); }
    catch { throw new HttpError(400, 'bad_request', 'Invalid restaurant ID.'); }
    return sendJson(res, 200, await savePlace(user.uid, videoId, restaurantId, method === 'PUT'));
  }
  const edit = path.match(/^\/api\/library\/([^/]+)\/([^/]+)$/);
  if (edit && method === 'PATCH') {
    const user = requireUser(req);
    let videoId, restaurantId;
    try { videoId = decodeURIComponent(edit[1]); restaurantId = decodeURIComponent(edit[2]); }
    catch { throw new HttpError(400, 'bad_request', 'Invalid restaurant ID.'); }
    const body = await jsonBody(req);
    return sendJson(res, 200, await editPlace(user.uid, videoId, restaurantId, body.edits));
  }
  if (path.startsWith('/covers/') && (method === 'GET' || method === 'HEAD'))
    return serveCover(res, path.slice('/covers/'.length), method === 'HEAD');
  if (path.startsWith('/api/')) {
    if (/^\/api\/(?:library|analyze|samples|geo|map|ask|chat|memory)(?:\/|$)/.test(path)) requireUser(req);
    throw new HttpError(501, 'not_implemented', 'This API is not implemented yet.');
  }
  if (method !== 'GET' && method !== 'HEAD') throw new HttpError(405, 'method_not_allowed', 'Method not allowed.');
  return serveStatic(res, path, method === 'HEAD');
}

const absent = missingConfig();
if (absent.length) {
  console.error(`Missing configuration: ${absent.join(', ')}`);
  process.exitCode = 1;
} else {
  const server = createServer((req, res) => {
    handle(req, res).catch(error => {
      if (res.headersSent) { res.destroy(); return; }
      if (!(error instanceof HttpError) && !(error instanceof GeoError)) console.error('Request failed:', error);
      sendJson(res, error.status || 500, { error: { code: error.code || 'internal_error', message: error instanceof HttpError ? error.message : 'Internal server error.' } }, error.headers || {});
    });
  });
  server.listen(config.port, config.host, () => console.log(`WeEat server listening on ${config.host}:${config.port}`));
  const stop = () => server.close(() => pool.end().then(() => process.exit(0)));
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}
