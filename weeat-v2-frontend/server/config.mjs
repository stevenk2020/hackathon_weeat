import { fileURLToPath } from 'node:url';

// Environment variables supplied by the caller take precedence over .env.local.
try { process.loadEnvFile(fileURLToPath(new URL('../.env.local', import.meta.url))); }
catch (error) { if (error?.code !== 'ENOENT') throw error; }

const env = process.env;
const list = value => (value || '').split(',').map(item => item.trim()).filter(Boolean);
const port = Number(env.PORT) || 30000;
const configuredOrigins = list(env.BASE_URLS).map(value => {
  try { return new URL(value).origin; } catch { return ''; }
}).filter(Boolean);
const baseUrls = configuredOrigins.length ? configuredOrigins : [`http://localhost:${port}`];

export const config = {
  port,
  host: env.HOST || '127.0.0.1',
  baseUrls,
  baseUrl: baseUrls[0],
  googleClientId: env.GOOGLE_CLIENT_ID || '',
  googleClientSecret: env.GOOGLE_CLIENT_SECRET || '',
  sessionSecret: env.SESSION_SECRET || '',
  crawlBaseUrl: env.CRAWL_API_BASE_URL || '',
  crawlApiKey: env.CRAWL_API_KEY || '',
  pg: {
    host: env.PGHOST || '127.0.0.1',
    port: Number(env.PGPORT) || 5432,
    database: env.PGDATABASE || 'we_eat_ai',
    user: env.PGUSER || undefined,
    password: env.PGPASSWORD || undefined,
  },
  pgPoolMax: Number(env.PGPOOL_MAX) || 10,
  openaiApiKey: env.OPENAI_API_KEY || '',
  goongApiKeys: list(env.GOONG_API_KEY),
  goongTileKeys: list(env.GOONG_MAPTILES_KEY),
  vietmapKey: env.VIETMAP_SERVICES_KEY || '',
};

export function missingConfig() {
  return [
    ['GOOGLE_CLIENT_ID', config.googleClientId],
    ['GOOGLE_CLIENT_SECRET', config.googleClientSecret],
    ['SESSION_SECRET', config.sessionSecret],
    ['CRAWL_API_BASE_URL', config.crawlBaseUrl],
    ['CRAWL_API_KEY', config.crawlApiKey],
    ['PGUSER', config.pg.user],
    ['PGPASSWORD', config.pg.password],
  ].filter(([, value]) => !value).map(([name]) => name);
}

export function originFor(req) {
  const header = name => String(req.headers?.[name] || '').split(',')[0].trim();
  const forwardedHost = header('x-forwarded-host');
  const forwardedProto = header('x-forwarded-proto');
  const host = header('host');
  const candidates = [
    forwardedHost && `${forwardedProto || 'https'}://${forwardedHost}`,
    host && `${req.socket?.encrypted ? 'https' : 'http'}://${host}`,
  ];
  for (const value of candidates) {
    if (!value) continue;
    try {
      const origin = new URL(value).origin;
      if (config.baseUrls.includes(origin)) return origin;
    } catch { /* ignore malformed Host */ }
  }
  return config.baseUrl;
}
