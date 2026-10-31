import { config } from './config.mjs';
import { query } from './db.mjs';

export function startTrace(userId, sessionId, userMessage) {
  return { userId, sessionId, userMessage, start: Date.now(), steps: [], models: [],
    promptTokens: 0, completionTokens: 0, firstDeltaMs: null };
}

export function summarizeResult(name, result) {
  if (name === 'search_saved_places') return { total: result.total_matches,
    items: (result.items || []).map(item => `${item.name} | ${item.dish} | ${item.price} | ${item.distance_m ?? ''}`), note: result.note };
  if (name === 'get_place_details') return { names: (result.places || []).map(item => item.name) };
  if (name === 'wiki_stats') return { total: result.total };
  if (name === 'geocode_place') return { labels: (result.places || []).map(item => item.label) };
  if (name === 'get_user_context') return { home: Boolean(result.home), memory: result.memory?.length || 0 };
  return result?.status || 'ok';
}

export async function recordTrace(trace, { status, answer = null, error = null } = {}) {
  await query(`INSERT INTO public.weeat_ai_trace
    (session_id,user_id,user_message,steps,answer,models,prompt_tokens,completion_tokens,first_delta_ms,duration_ms,status,error)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
  [trace.sessionId, trace.userId, trace.userMessage, JSON.stringify(trace.steps), answer,
    trace.models, trace.promptTokens, trace.completionTokens, trace.firstDeltaMs,
    Date.now() - trace.start, status, error]);
}

export async function purgeTraces(days = config.askTraceDays) {
  await query(`DELETE FROM public.weeat_ai_trace WHERE created_at < now() - ($1::int * interval '1 day')`, [days]);
}
