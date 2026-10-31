import { pathToFileURL } from 'node:url';
import { pool, query } from './db.mjs';
import { syncIndex } from './placeIndex.mjs';

export async function migrateAsk() {
  const statements = [
    `CREATE TABLE IF NOT EXISTS public.weeat_place_index (
      user_id bigint NOT NULL, video_id text NOT NULL, restaurant_id text NOT NULL,
      name_fold text NOT NULL DEFAULT '', dish_fold text NOT NULL DEFAULT '', address_fold text NOT NULL DEFAULT '',
      cate_id integer, price_vnd bigint, price_vnd_max bigint, lat double precision, lng double precision,
      doc tsvector NOT NULL DEFAULT ''::tsvector, doc_video tsvector NOT NULL DEFAULT ''::tsvector,
      embedding real[], is_saved boolean NOT NULL DEFAULT false, updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id,video_id,restaurant_id))`,
    `ALTER TABLE public.weeat_place_index ADD COLUMN IF NOT EXISTS doc_video tsvector NOT NULL DEFAULT ''::tsvector`,
    `CREATE INDEX IF NOT EXISTS weeat_place_index_doc_video ON public.weeat_place_index USING gin (doc_video)`,
    `CREATE INDEX IF NOT EXISTS weeat_place_index_user_saved ON public.weeat_place_index (user_id,is_saved)`,
    `CREATE INDEX IF NOT EXISTS weeat_place_index_doc ON public.weeat_place_index USING gin (doc)`,
    `CREATE INDEX IF NOT EXISTS weeat_place_index_geo ON public.weeat_place_index (user_id,lat,lng)`,
    `CREATE TABLE IF NOT EXISTS public.weeat_chat_sessions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id bigint NOT NULL, title text NOT NULL DEFAULT '',
      location jsonb, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`,
    `ALTER TABLE public.weeat_chat_sessions ADD COLUMN IF NOT EXISTS location jsonb`,
    `CREATE INDEX IF NOT EXISTS weeat_chat_sessions_user ON public.weeat_chat_sessions (user_id,updated_at DESC)`,
    `CREATE TABLE IF NOT EXISTS public.weeat_chat_messages (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), session_id uuid NOT NULL REFERENCES public.weeat_chat_sessions(id) ON DELETE CASCADE,
      role text NOT NULL CHECK (role IN ('user','assistant')), content text NOT NULL,
      refs jsonb NOT NULL DEFAULT '[]', ui jsonb, created_at timestamptz NOT NULL DEFAULT now())`,
    `ALTER TABLE public.weeat_chat_messages ADD COLUMN IF NOT EXISTS ui jsonb`,
    `CREATE INDEX IF NOT EXISTS weeat_chat_messages_session ON public.weeat_chat_messages (session_id,created_at)`,
    `CREATE TABLE IF NOT EXISTS public.weeat_user_memory (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id bigint NOT NULL, kind text NOT NULL DEFAULT 'preference',
      text text NOT NULL, text_fold text NOT NULL, source_session_id uuid,
      created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (user_id,text_fold))`,
    `CREATE TABLE IF NOT EXISTS public.weeat_ai_usage (
      id bigserial PRIMARY KEY, user_id bigint NOT NULL, model text NOT NULL,
      prompt_tokens int NOT NULL DEFAULT 0, completion_tokens int NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now())`,
    `CREATE INDEX IF NOT EXISTS weeat_ai_usage_user_day ON public.weeat_ai_usage (user_id,created_at)`,
    `CREATE TABLE IF NOT EXISTS public.weeat_ai_trace (
      id bigserial PRIMARY KEY, session_id uuid REFERENCES public.weeat_chat_sessions(id) ON DELETE CASCADE,
      user_id bigint NOT NULL, user_message text NOT NULL, steps jsonb NOT NULL DEFAULT '[]', answer text,
      models text[] NOT NULL DEFAULT '{}', prompt_tokens int NOT NULL DEFAULT 0, completion_tokens int NOT NULL DEFAULT 0,
      first_delta_ms int, duration_ms int NOT NULL DEFAULT 0, status text NOT NULL, error text,
      created_at timestamptz NOT NULL DEFAULT now())`,
    `CREATE INDEX IF NOT EXISTS weeat_ai_trace_session ON public.weeat_ai_trace (session_id,created_at)`,
    `CREATE INDEX IF NOT EXISTS weeat_ai_trace_created ON public.weeat_ai_trace (created_at DESC)`,
  ];
  for (const sql of statements) await query(sql);
  const extensions = await query(`SELECT extname FROM pg_extension WHERE extname IN ('pg_trgm','vector')`);
  const names = new Set(extensions.rows.map(row => row.extname));
  if (names.has('pg_trgm')) await query(`CREATE INDEX IF NOT EXISTS weeat_place_index_name_trgm
    ON public.weeat_place_index USING gin ((name_fold || ' ' || dish_fold) public.gin_trgm_ops)`);
  if (names.has('vector')) await query(`CREATE TABLE IF NOT EXISTS public.weeat_place_embedding (
    user_id bigint NOT NULL, video_id text NOT NULL, restaurant_id text NOT NULL,
    doc_hash text NOT NULL, embedding vector(1536) NOT NULL,
    PRIMARY KEY (user_id,video_id,restaurant_id))`);
  const rows = await syncIndex();
  return { rows, trigram: names.has('pg_trgm'), vector: names.has('vector') };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  migrateAsk().then(result => console.log(`Ask AI index ready: ${result.rows} rows; pg_trgm ${result.trigram ? 'ready' : 'unavailable'}`))
    .catch(error => { console.error('Ask AI migration failed:', error); process.exitCode = 1; })
    .finally(() => pool.end());
}
