'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp, configFromEnv } = require('../server');

const videoUrl = 'https://www.tiktok.com/@test/video/1234567890123456789';
const key = 'x'.repeat(32);
const metadata = {
  is_about_specific_place: true,
  restaurant_name: { value: 'Cafe Test', source: 'description', evidence: 'Cafe Test', confidence: 'high' },
  dish: { value: null, source: null, evidence: null, confidence: null },
  location: { value: null, source: null, evidence: null, confidence: null },
  price: { value: null, source: null, evidence: null, confidence: null },
  dish_group: 'cafe',
};
const fakeFetch = async url => {
  url = String(url);
  if (url.startsWith('https://www.tiktok.com/oembed?')) return new Response(JSON.stringify({ title: 'Cafe Test', author_name: 'Test', author_url: 'https://www.tiktok.com/@test' }), { headers: { 'Content-Type': 'application/json' } });
  if (url.includes(':generateContent')) return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(metadata) }] } }] }), { headers: { 'Content-Type': 'application/json' } });
  throw new Error(`Unexpected request host: ${new URL(url).host}`);
};

test('extract endpoint reports database success and failure while retaining SQLite results', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'weeat-pg-test-'));
  let fail = false;
  const writes = [];
  const postgres = {
    async writeExtract(email, name, link, places, sqliteRows) {
      writes.push({ email, name, link, places, sqliteRows });
      if (fail) throw Object.assign(new Error('fake database error'), { code: 'XX000' });
    },
    async close() {},
  };
  const config = configFromEnv({
    YOUTUBE_API_KEY: 'fake', GEMINI_API_KEY: 'fake', SAVE_TOKEN_SECRET: 'test-secret-with-at-least-32-characters',
    EXTRACT_API_KEY: key, PG_WRITE_ENABLED: '1', WEB_SEARCH_PROVIDER: '', TIKTOK_COVER_SAVE: '0',
    LIBRARY_DB_PATH: path.join(root, 'library.db'), CACHE_DIR: path.join(root, 'cache'),
  });
  const app = createApp(config, { fetchImpl: fakeFetch, postgres, tiktokVideo: null, tiktokPhotos: null, logger: { error() {} } });
  try {
    await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
    const request = async () => {
      const response = await fetch(`http://127.0.0.1:${app.server.address().port}/api/extract`, {
        method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: videoUrl, email: 'friend@example.com', name: 'Friend' }),
      });
      return { status: response.status, body: await response.json() };
    };
    const first = await request();
    assert.equal(first.status, 200);
    assert.equal(first.body.postgres, 'written');
    assert.equal(first.body.postgres_places, 'written');
    assert.equal(first.body.places.length, 1);
    assert.equal(writes[0].sqliteRows.length, 1);
    fail = true;
    const second = await request();
    assert.equal(second.status, 200);
    assert.equal(second.body.postgres, 'failed');
    assert.equal(second.body.postgres_places, 'failed');
    assert.equal(second.body.places.length, 1);
  } finally {
    await app.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
