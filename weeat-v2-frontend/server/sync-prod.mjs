import pg from 'pg';
import { fileURLToPath } from 'node:url';
import { syncIndex } from './placeIndex.mjs';

// The default is an audit. --apply only inserts missing places and refreshes the derived index.
try { process.loadEnvFile(fileURLToPath(new URL('../.env.local', import.meta.url))); }
catch (error) { if (error.code !== 'ENOENT') throw error; }

const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const includeTest = args.has('--include-test-user');
const expectedArg = [...args].find(arg => arg.startsWith('--expect='));
const expected = expectedArg ? Number(expectedArg.slice('--expect='.length)) : null;
const quote = name => `"${String(name).replaceAll('"', '""')}"`;
const key = (userId, videoId, restaurantId) => `${userId}\u0000${videoId}\u0000${restaurantId}`;
const env = process.env;

function connection(suffix) {
  const password = env[`PGPASSWORD${suffix}`] || env[`PGASSWORD${suffix}`];
  for (const name of ['PGHOST', 'PGPORT', 'PGDATABASE', 'PGUSER'])
    if (!env[`${name}${suffix}`]) throw new Error(`Missing ${name}${suffix}`);
  if (!password) throw new Error(`Missing PGPASSWORD${suffix} (PGASSWORD${suffix} is also accepted)`);
  return new pg.Client({ host: env[`PGHOST${suffix}`], port: Number(env[`PGPORT${suffix}`]),
    database: env[`PGDATABASE${suffix}`], user: env[`PGUSER${suffix}`], password });
}

async function columns(client, table) {
  return (await client.query(`SELECT column_name,udt_name,is_nullable FROM information_schema.columns
    WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`, [table])).rows;
}

async function checkSchema(old, prod) {
  for (const table of ['user_dim', 'cate_dim', 'quan_hackathon_video_places', 'weeat_place_index']) {
    const a = await columns(old, table), b = await columns(prod, table);
    if (!a.length || a.length !== b.length) throw new Error(`${table}: missing or different column count`);
    const target = new Map(b.map(item => [item.column_name, item]));
    for (const col of a) {
      const dest = target.get(col.column_name);
      if (!dest || dest.udt_name !== col.udt_name || dest.is_nullable !== col.is_nullable)
        throw new Error(`${table}.${col.column_name}: incompatible schema`);
    }
  }
  const a = (await old.query('SELECT cate_id,cate_name_vn,cate_name_en FROM public.cate_dim ORDER BY cate_id')).rows;
  const b = (await prod.query('SELECT cate_id,cate_name_vn,cate_name_en FROM public.cate_dim ORDER BY cate_id')).rows;
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error('cate_dim differs: review category mapping before copying places');
  const extensions = (await prod.query(`SELECT extname FROM pg_extension WHERE extname IN ('unaccent','pg_trgm')`)).rows;
  if (!extensions.some(row => row.extname === 'unaccent')) throw new Error('Production needs unaccent for the place index');
  return (await columns(old, 'quan_hackathon_video_places')).map(item => item.column_name);
}

async function indexHealth(client) {
  const row = (await client.query(`SELECT
    (SELECT count(*)::int FROM public.quan_hackathon_video_places) AS places,
    (SELECT count(*)::int FROM public.weeat_place_index) AS indexed,
    (SELECT count(*)::int FROM public.quan_hackathon_video_places p LEFT JOIN public.weeat_place_index i
      USING (user_id,video_id,restaurant_id) WHERE i.user_id IS NULL) AS missing,
    (SELECT count(*)::int FROM public.weeat_place_index i JOIN public.quan_hackathon_video_places p
      USING (user_id,video_id,restaurant_id) WHERE i.is_saved IS DISTINCT FROM p.is_saved) AS saved_mismatch`)).rows[0];
  return row;
}

async function main() {
  const oldTarget = [env.PGHOST, env.PGPORT, env.PGDATABASE].join(':');
  const prodTarget = [env.PGHOST_PROD, env.PGPORT_PROD, env.PGDATABASE_PROD].join(':');
  if (oldTarget === prodTarget) throw new Error('Source and destination resolve to the same connection');
  if (apply && (!Number.isInteger(expected) || expected < 0))
    throw new Error('--apply also requires --expect=<audited missing-place count>');
  const old = connection(''), prod = connection('_PROD');
  await old.connect();
  try {
    await prod.connect();
    try {
      await old.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      await prod.query(apply ? 'BEGIN' : 'BEGIN READ ONLY');
      try {
        const placeColumns = await checkSchema(old, prod);
        const oldUsers = (await old.query('SELECT user_id,lower(user_email) AS email FROM public.user_dim')).rows;
        const prodUsers = (await prod.query('SELECT user_id,lower(user_email) AS email FROM public.user_dim')).rows;
        const byEmail = new Map(prodUsers.map(row => [row.email, row.user_id]));
        if (new Set(oldUsers.map(row => row.email)).size !== oldUsers.length || byEmail.size !== prodUsers.length)
          throw new Error('Duplicate case-insensitive user emails; manual mapping required');
        const userMap = new Map();
        for (const user of oldUsers) {
          const mapped = byEmail.get(user.email);
          if (!mapped) throw new Error(`A source user is missing in production (old user_id ${user.user_id})`);
          userMap.set(String(user.user_id), { target: String(mapped), email: user.email });
        }
        const oldPlaces = (await old.query(`SELECT user_id,video_id,restaurant_id,is_saved
          FROM public.quan_hackathon_video_places`)).rows;
        const prodPlaces = (await prod.query(`SELECT user_id,video_id,restaurant_id,is_saved
          FROM public.quan_hackathon_video_places`)).rows;
        const dest = new Map(prodPlaces.map(row => [key(row.user_id, row.video_id, row.restaurant_id), row]));
        const missing = [], ignored = [];
        let shared = 0, savedMismatch = 0;
        for (const row of oldPlaces) {
          const owner = userMap.get(String(row.user_id));
          const found = dest.get(key(owner.target, row.video_id, row.restaurant_id));
          if (found) { shared++; if (row.is_saved !== found.is_saved) savedMismatch++; continue; }
          if (!includeTest && owner.email === 'extract-test@example.com') ignored.push(row);
          else missing.push(row);
        }
        const before = await indexHealth(prod);
        console.log(JSON.stringify({ mode: apply ? 'apply' : 'audit', scope: includeTest ? 'all users' : 'without test user',
          usersMapped: userMap.size, userIdsRemapped: [...userMap.entries()].filter(([id, item]) => id !== item.target).length,
          sharedPlaces: shared, sharedSavedConflictsPreserved: savedMismatch, candidates: missing.length,
          excludedTestPlaces: ignored.length, productionIndexBefore: before }));
        if (apply) {
          if (missing.length !== expected) throw new Error(`Audit changed: expected ${expected} candidates, found ${missing.length}`);
          const fields = placeColumns.map(quote).join(',');
          const placeholders = placeColumns.map((_, index) => `$${index + 1}`).join(',');
          const insert = `INSERT INTO public.quan_hackathon_video_places (${fields}) VALUES (${placeholders})
            ON CONFLICT (user_id,video_id,restaurant_id) DO NOTHING RETURNING user_id`;
          let inserted = 0;
          for (const item of missing) {
            const source = (await old.query(`SELECT * FROM public.quan_hackathon_video_places
              WHERE user_id=$1 AND video_id=$2 AND restaurant_id=$3`,
            [item.user_id, item.video_id, item.restaurant_id])).rows[0];
            if (!source) throw new Error('A source place vanished during migration');
            source.user_id = userMap.get(String(item.user_id)).target;
            inserted += (await prod.query(insert, placeColumns.map(name => source[name]))).rowCount;
          }
          if (inserted !== expected) throw new Error(`Insert count changed: expected ${expected}, inserted ${inserted}`);
          await syncIndex(null, null, null, (sql, values) => prod.query(sql, values), false);
          const after = await indexHealth(prod);
          if (after.missing || after.saved_mismatch) throw new Error('Index validation failed; transaction rolled back');
          await prod.query('COMMIT');
          console.log(JSON.stringify({ inserted, productionIndexAfter: after }));
        } else await prod.query('ROLLBACK');
        await old.query('ROLLBACK');
      } catch (error) {
        await prod.query('ROLLBACK').catch(() => {});
        await old.query('ROLLBACK').catch(() => {});
        throw error;
      }
    } finally { await prod.end(); }
  } finally { await old.end(); }
}

main().catch(error => { console.error('Production mapping stopped:', error.message); process.exitCode = 1; });
