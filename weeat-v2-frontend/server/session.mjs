import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from './config.mjs';

function signature(body) {
  return createHmac('sha256', config.sessionSecret).update(body).digest('base64url');
}

export function seal(data, ttlSeconds = 7 * 24 * 60 * 60) {
  const body = Buffer.from(JSON.stringify({ ...data, exp: Math.floor(Date.now() / 1000) + ttlSeconds })).toString('base64url');
  return `${body}.${signature(body)}`;
}

export function unseal(token) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return null;
  const [body, mac] = token.split('.');
  const expected = signature(body);
  const actualBytes = Buffer.from(mac);
  const expectedBytes = Buffer.from(expected);
  if (actualBytes.length !== expectedBytes.length || !timingSafeEqual(actualBytes, expectedBytes)) return null;
  try {
    const data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!data || typeof data !== 'object' || !Number.isFinite(data.exp) || data.exp <= Date.now() / 1000) return null;
    return data;
  } catch { return null; }
}

export function readCookie(req, name) {
  const header = req.headers?.cookie;
  if (typeof header !== 'string') return null;
  for (const part of header.split(';')) {
    const equals = part.indexOf('=');
    if (equals < 0 || part.slice(0, equals).trim() !== name) continue;
    try { return decodeURIComponent(part.slice(equals + 1).trim()); } catch { return null; }
  }
  return null;
}

export function cookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${options.path || '/'}`, 'HttpOnly', 'SameSite=Lax'];
  if (options.maxAge !== undefined) parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAge))}`);
  if (options.secure) parts.push('Secure');
  return parts.join('; ');
}
