import { query } from './db.mjs';
import { embed } from './llm.mjs';

// Search-only projection. Source rows are never modified by the indexer.
const folded = expression => `lower(unaccent(coalesce(${expression}, '')))`;
const expand = expression => `regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
  ${folded(expression)}, '\\m(bd)\\M', 'binh duong', 'g'), '\\m(tdm)\\M', 'thu dau mot', 'g'),
  '\\m(tphcm|hcmc|hcm)\\M', 'ho chi minh', 'g'), '\\m(hn)\\M', 'ha noi', 'g'),
  '\\m(q)[.]? *([0-9]+)\\M', 'quan \\2', 'g')`;

export async function syncIndex(userId = null, videoId = null, restaurantId = null, execute = query, prune = true) {
  const result = await execute(`INSERT INTO public.weeat_place_index
    (user_id, video_id, restaurant_id, name_fold, dish_fold, address_fold, cate_id,
     price_vnd, price_vnd_max, lat, lng, doc, doc_video, is_saved, updated_at)
    SELECT p.user_id, p.video_id, p.restaurant_id,
      ${folded('p.restaurant_name')}, ${folded('p.dish')}, ${expand('coalesce(p.address_text,p.address)')},
      p.cate_id, p.price_vnd, p.price_vnd_max, p.latitude, p.longitude,
      to_tsvector('simple', ${folded("concat_ws(' ',p.restaurant_name,p.dish,coalesce(p.address_text,p.address),p.user_note,p.cate_name,p.search_text)")}),
      to_tsvector('simple', ${folded("concat_ws(' ',p.title,p.script_text,p.comments_text)")}),
      coalesce(p.is_saved,false), now()
    FROM public.quan_hackathon_video_places p
    WHERE ($1::bigint IS NULL OR p.user_id=$1) AND ($2::text IS NULL OR p.video_id=$2)
      AND ($3::text IS NULL OR p.restaurant_id=$3)
      AND p.video_id IS NOT NULL AND p.restaurant_id IS NOT NULL
    ON CONFLICT (user_id, video_id, restaurant_id) DO UPDATE SET
      name_fold=excluded.name_fold, dish_fold=excluded.dish_fold, address_fold=excluded.address_fold,
      cate_id=excluded.cate_id, price_vnd=excluded.price_vnd, price_vnd_max=excluded.price_vnd_max,
      lat=excluded.lat, lng=excluded.lng, doc=excluded.doc, doc_video=excluded.doc_video,
      is_saved=excluded.is_saved, updated_at=now()`, [userId, videoId, restaurantId]);
  if (prune && videoId === null && restaurantId === null) {
    await execute(`DELETE FROM public.weeat_place_index i WHERE ($1::bigint IS NULL OR i.user_id=$1)
      AND NOT EXISTS (SELECT 1 FROM public.quan_hackathon_video_places p WHERE p.user_id=i.user_id
      AND p.video_id=i.video_id AND p.restaurant_id=i.restaurant_id)`, [userId]);
  }
  return result.rowCount;
}

export async function syncIndexSafe(...args) {
  try { return await syncIndex(...args); }
  catch (error) { console.warn('ask index sync failed:', error.code || error.name); return 0; }
}

export async function ensureIndexFresh(userId) {
  const source = await query(`SELECT count(*)::int AS rows, count(*) FILTER (WHERE is_saved)::int AS saved,
    max(greatest(coalesce(update_time,'epoch'::timestamptz),coalesce(synced_at,'epoch'::timestamptz),
      coalesce(create_time,'epoch'::timestamptz))) AS newest
    FROM public.quan_hackathon_video_places WHERE user_id=$1`, [userId]);
  const index = await query(`SELECT count(*)::int AS rows, count(*) FILTER (WHERE is_saved)::int AS saved,
    max(updated_at) AS newest FROM public.weeat_place_index WHERE user_id=$1`, [userId]);
  const a = source.rows[0], b = index.rows[0];
  if (a.rows !== b.rows || a.saved !== b.saved || (a.newest && (!b.newest || new Date(a.newest) > new Date(b.newest)))) {
    await syncIndex(userId); return true;
  }
  return false;
}

let vectorReady;
export async function ensureEmbeddings(userId) {
  if (vectorReady === undefined) {
    vectorReady = (await query(`SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname='vector') AS ready`)).rows[0].ready;
  }
  if (!vectorReady) return false;
  const document = `concat_ws(' | ',p.restaurant_name,p.dish,coalesce(p.address_text,p.address),p.cate_name,p.user_note)`;
  const rows = (await query(`SELECT p.video_id,p.restaurant_id,${document} AS document,
    md5(${document}) AS hash FROM public.quan_hackathon_video_places p
    LEFT JOIN public.weeat_place_embedding e USING (user_id,video_id,restaurant_id)
    WHERE p.user_id=$1 AND p.is_saved AND p.video_id IS NOT NULL AND p.restaurant_id IS NOT NULL
      AND e.doc_hash IS DISTINCT FROM md5(${document}) LIMIT 60`, [userId])).rows;
  if (!rows.length) return true;
  const vectors = await embed(rows.map(row => row.document));
  for (let i = 0; i < rows.length; i++) {
    if (!Array.isArray(vectors[i]) || vectors[i].length !== 1536) throw new Error('Invalid embedding dimensions');
    await query(`INSERT INTO public.weeat_place_embedding (user_id,video_id,restaurant_id,doc_hash,embedding)
      VALUES ($1,$2,$3,$4,$5::vector) ON CONFLICT (user_id,video_id,restaurant_id)
      DO UPDATE SET doc_hash=excluded.doc_hash,embedding=excluded.embedding`,
    [userId, rows[i].video_id, rows[i].restaurant_id, rows[i].hash, JSON.stringify(vectors[i])]);
  }
  return true;
}
