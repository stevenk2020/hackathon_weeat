'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPostgres, placeRow } = require('../lib/postgres');
const linkColumns = require('../spec/row_columns.json');

const samplePlace = () => ({
  id: 'doc123', restaurant_id: 'restaurant123', cate_id: 14,
  thumbnail_url: null, sharedUrl: 'https://www.youtube.com/shorts/AAAAAAAAAAA',
  source: { videoId: 'AAAAAAAAAAA', platform: 'youtube', media: 'video', videoUrl: 'https://www.youtube.com/shorts/AAAAAAAAAAA', videoTitle: 'Test restaurant', channel: 'Test', venueIndex: 1, model: 'test-model', promptVersion: '12345678', analysisCreatedAt: '2026-10-31T00:00:00.000Z', cacheHit: false, analysisMode: 'video_and_text' },
  display: { name: 'Test Place', dish: 'Phở', location: '1 Test Street', price: '50k' },
  cate_name: 'Khác', cate_name_en: 'Other', address: '1 Test Street', address_text: '1 Test Street', price_text: '50k', price_vnd: 50000, price_vnd_max: 50000, price_inferred: true,
  matchScore: 90, latitude: null, longitude: null, geoSource: null, mapsSearchUrl: null, mapsNote: null, shopeeFoodUrl: null, shopeeFoodSearchUrl: null,
  hasConflict: false, conflictFields: [], incomplete: false, missingFields: [], userNote: null,
  venue: {
    restaurant_name: { status: 'found', entries: [{ value: 'Test Place', origin: 'video', source: 'on_screen_text', confidence: 'high', evidence: 'Test Place', timestamp: '00:01', evidence_checked: false }] },
    dish: { status: 'found', entries: [{ value: 'Phở', origin: 'video', source: 'spoken_audio', confidence: 'high', evidence: 'Phở', timestamp: '00:03', evidence_checked: false }] },
    location: { status: 'found', entries: [{ value: '1 Test Street', origin: 'metadata', source: 'title_description', source_detail: 'description', confidence: 'high', evidence: '1 Test Street', evidence_checked: true }] },
    price: { status: 'found', entries: [{ value: '50k', origin: 'video', source: 'on_screen_text', confidence: 'high', evidence: '50k', timestamp: '00:04', evidence_checked: false, normalized: { min: 50000, max: 50000, currency: 'VND', inferred: true, basis: 'k' } }] },
  },
  script: { status: 'ok', reason: null, lines: [{ timestamp: '00:01', kind: 'on_screen', text: 'Test Place' }] },
  comments: { status: 'unavailable', reason: 'none', items: [], sentiment: null },
  searchText: 'test place pho', savedVia: 'extract_api',
});
const sqliteRow = () => ({ create_time: '2026-10-31T00:00:05.000Z', update_time: '2026-10-31T00:00:05.000Z', is_saved: 0, data: JSON.stringify({ schemaVersion: 4, tokenIssuedAt: '2026-10-31T00:00:00.000Z' }) });
const link = () => ({ ...Object.fromEntries(linkColumns.map(column => [column, null])), url: 'https://www.youtube.com/shorts/AAAAAAAAAAA', is_saved: true, video_id: 'AAAAAAAAAAA', place_count: 1 });

function fakePool(failAt = null) {
  const calls = [];
  const client = {
    async query(sql, values) {
      calls.push({ sql, values });
      if (failAt && sql.includes(failAt)) throw Object.assign(new Error('fake failure'), { code: 'XX000' });
      if (sql.includes('RETURNING user_id')) return { rows: [{ user_id: '12' }] };
      return { rows: [] };
    },
    release() { calls.push({ sql: 'RELEASE' }); },
  };
  return { calls, pool: { async connect() { return client; }, async end() { calls.push({ sql: 'END' }); } } };
}

test('PostgreSQL mapping covers all 149 supplied columns and keeps evidence and types', () => {
  const row = placeRow('12', samplePlace(), sqliteRow());
  assert.equal(Object.keys(row).length, 149); // synced_at is the 150th column and has a DB default
  assert.equal(row.name_evidence, 'Test Place');
  assert.equal(row.location_evidence_checked, true);
  assert.equal(row.price_norm_vnd, 50000);
  assert.equal(row.is_saved, false); // live PostgreSQL column is boolean
  assert.equal(row.saved_via, 'extract_api');
  assert.equal(row.script_text, '[00:01 on_screen] Test Place');
});

test('extract writer uses one transaction and bound values for both tables', async () => {
  const { calls, pool } = fakePool();
  const writer = createPostgres({ pgWriteEnabled: true }, { pool });
  await writer.writeExtract(' FRIEND@EXAMPLE.COM ', 'Friend', link(), [samplePlace()], [sqliteRow()]);
  assert.deepEqual(calls.map(call => call.sql === 'BEGIN' || call.sql === 'COMMIT' || call.sql === 'RELEASE' ? call.sql : call.sql.includes('INSERT INTO public.user_dim') ? 'USER' : call.sql.includes('INSERT INTO public.hackathon_video_places') ? 'LINK' : 'PLACE'), ['BEGIN', 'USER', 'LINK', 'PLACE', 'COMMIT', 'RELEASE']);
  assert.deepEqual(calls[1].values, ['friend@example.com', 'Friend']);
  assert.equal(calls[2].values[0], '12');
  assert.ok(calls[3].sql.includes('is_saved=quan_hackathon_video_places.is_saved'));
  assert.ok(calls[3].sql.includes('user_note=COALESCE(EXCLUDED.user_note, quan_hackathon_video_places.user_note)'));
  assert.ok(calls[3].sql.includes('ON CONFLICT (user_id, video_id, restaurant_id)'));
  assert.ok(!calls[3].sql.includes('Test Place'));
  await writer.close();
});

test('extract writer rolls both tables back when a place insert fails', async () => {
  const { calls, pool } = fakePool('INSERT INTO public.quan_hackathon_video_places');
  const writer = createPostgres({ pgWriteEnabled: true }, { pool });
  await assert.rejects(writer.writeExtract('friend@example.com', null, link(), [samplePlace()], [sqliteRow()]), /fake failure/);
  assert.ok(calls.some(call => call.sql === 'ROLLBACK'));
  assert.ok(!calls.some(call => call.sql === 'COMMIT'));
  assert.equal(calls.at(-1).sql, 'RELEASE');
});

test('extract writer replaces individual comments in the same transaction', async () => {
  const { calls, pool } = fakePool();
  const writer = createPostgres({ pgWriteEnabled: true }, { pool });
  const place = samplePlace();
  place.comments = {
    status: 'ok', reason: null, sentiment: null,
    items: [
      { text: 'Good food', sentiment: 'positive', likes: 12 },
      { text: 'Too busy', sentiment: null, likes: 0 },
    ],
  };
  await writer.writeExtract('friend@example.com', null, link(), [place], [sqliteRow()]);
  const deleteCall = calls.find(call => call.sql.startsWith('DELETE FROM public.quan_hackathon_video_comments'));
  const inserts = calls.filter(call => call.sql.includes('INSERT INTO public.quan_hackathon_video_comments'));
  assert.deepEqual(deleteCall.values, ['AAAAAAAAAAA', 'restaurant123']);
  assert.deepEqual(inserts.map(call => call.values), [
    ['AAAAAAAAAAA', 'restaurant123', 1, 'Good food', 'positive', 12],
    ['AAAAAAAAAAA', 'restaurant123', 2, 'Too busy', null, 0],
  ]);
  assert.ok(calls.indexOf(deleteCall) < calls.indexOf(inserts[0]));
  assert.ok(calls.indexOf(inserts[1]) < calls.findIndex(call => call.sql === 'COMMIT'));
});

test('unavailable comments keep existing rows, and comment write failure rolls back', async () => {
  const unavailable = fakePool();
  await createPostgres({ pgWriteEnabled: true }, { pool: unavailable.pool })
    .writeExtract('friend@example.com', null, link(), [samplePlace()], [sqliteRow()]);
  assert.ok(!unavailable.calls.some(call => call.sql.includes('quan_hackathon_video_comments')));

  const failing = fakePool('INSERT INTO public.quan_hackathon_video_comments');
  const place = samplePlace();
  place.comments = { status: 'ok', items: [{ text: 'Good food', sentiment: 'positive', likes: 12 }] };
  await assert.rejects(
    createPostgres({ pgWriteEnabled: true }, { pool: failing.pool })
      .writeExtract('friend@example.com', null, link(), [place], [sqliteRow()]),
    /fake failure/
  );
  assert.ok(failing.calls.some(call => call.sql === 'ROLLBACK'));
  assert.ok(!failing.calls.some(call => call.sql === 'COMMIT'));
});
