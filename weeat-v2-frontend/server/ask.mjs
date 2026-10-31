import { readFileSync } from 'node:fs';
import { config } from './config.mjs';
import { query } from './db.mjs';
import { HttpError } from './places.mjs';
import { complete, llmConfigured } from './llm.mjs';
import { TOOL_SPECS, categoryLegend, fold, runTool } from './askTools.mjs';
import { ensureIndexFresh } from './placeIndex.mjs';
import { recordTrace, startTrace, summarizeResult } from './askTrace.mjs';
import { resolveAddress, suggestAddresses } from './geo.mjs';

const systemText = readFileSync(new URL('../docs/spec/ask-ai/system-prompt.txt', import.meta.url), 'utf8');
const followupText = readFileSync(new URL('../docs/spec/ask-ai/followup-prompt.txt', import.meta.url), 'utf8');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const recent = new Map();
const vi = message => /[ăâđêôơưàáảãạèéẻẽẹìíỉĩịòóỏõọùúủũụỳýỷỹỵ]/i.test(message);
const fallback = (language, searched) => searched ? language === 'vi'
  ? 'Mình chưa tìm thấy quán nào phù hợp trong danh sách quán bạn đã lưu.'
  : "I couldn't find a matching place in the restaurants you've saved."
  : language === 'vi' ? 'Mình chưa trả lời được lúc này. Bạn thử lại sau một chút nhé.'
    : "I couldn't answer just now. Please try again in a moment.";

export function SYSTEM(memory, today, replyIn, categories) {
  return systemText.replaceAll('${replyIn}', replyIn).replaceAll('${today}', today)
    .replaceAll('${categories}', categories || 'not available')
    .replaceAll('${categories || "not available"}', categories || 'not available')
    .replace(/^\$\{memory\.length.*\}$/m,
      memory.length ? memory.map(item => `- ${item.text}`).join('\n') : '- (nothing saved yet)');
}

// Hold partial markers across OpenAI chunks; only release ordinary prose.
export function markerFilter(onText) {
  let pending = '', all = '', numbers = [], none = false;
  const output = value => { if (value) { all += value; onText(value); } };
  const consume = (final = false) => {
    while (pending) {
      const start = pending.indexOf('[[');
      if (start < 0) {
        const hold = !final && pending.endsWith('[') ? 1 : 0;
        output(pending.slice(0, pending.length - hold)); pending = pending.slice(pending.length - hold); break;
      }
      output(pending.slice(0, start)); pending = pending.slice(start);
      const match = pending.match(/^\[\[\s*\d+(?:\s*,\s*\d+)*\s*\]\]/);
      if (match) {
        for (const token of match[0].slice(2, -2).split(',')) {
          const number = Number(token.trim()); if (number === 0) none = true; else numbers.push(number);
        }
        pending = pending.slice(match[0].length); continue;
      }
      if (!final && /^\[\[\s*(?:\d+(?:\s*,\s*\d*)*\s*)?\]?$/.test(pending)) break;
      output(pending.slice(0, 1)); pending = pending.slice(1);
    }
  };
  return { write(value) { pending += value; consume(); }, flush() { consume(true); },
    get text() { return all; }, get numbers() { return numbers; }, get none() { return none; } };
}

async function enforceLimits(userId) {
  const now = Date.now();
  const times = (recent.get(String(userId)) || []).filter(time => now - time < 600_000);
  if (times.length >= config.askRateLimit) throw new HttpError(429, 'rate_limited',
    "You're asking too fast. Please wait a few minutes.", { 'Retry-After': '60' });
  const tokens = await query(`SELECT coalesce(sum(prompt_tokens+completion_tokens),0)::int AS used
    FROM public.weeat_ai_usage WHERE user_id=$1 AND created_at > now() - interval '24 hours'`, [userId]);
  if (tokens.rows[0].used >= config.askMaxTokensPerDay) throw new HttpError(429, 'daily_limit',
    "You've reached today's Ask AI limit. Please come back tomorrow.", { 'Retry-After': '3600' });
  times.push(now); recent.set(String(userId), times);
}

async function resolveLocation(input) {
  if (!input || typeof input.label !== 'string' || input.label.trim().length < 2 || input.label.length > 200)
    throw new HttpError(400, 'bad_request', 'Choose a valid location.');
  const result = { label: input.label.trim(), source: input.source || 'typed' };
  if (input.latitude != null || input.longitude != null) {
    if (!Number.isFinite(input.latitude) || !Number.isFinite(input.longitude) ||
      Math.abs(input.latitude) > 90 || Math.abs(input.longitude) > 180)
      throw new HttpError(400, 'bad_request', 'Invalid location coordinates.');
    Object.assign(result, { latitude: input.latitude, longitude: input.longitude, resolved: true });
  } else {
    try {
      const first = (await suggestAddresses(result.label))[0];
      if (first) {
        const found = await resolveAddress(first.ref);
        Object.assign(result, { latitude: found.latitude, longitude: found.longitude,
          matched_label: found.label, resolved: true });
      }
    } catch { /* label-only area search is still useful */ }
    if (!result.resolved) result.resolved = false;
  }
  return result;
}

async function openSession(userId, message, sessionId) {
  if (sessionId) {
    if (!UUID.test(sessionId)) throw new HttpError(404, 'not_found', 'Chat not found.');
    const row = await query('SELECT id,location FROM public.weeat_chat_sessions WHERE id=$1 AND user_id=$2', [sessionId, userId]);
    if (!row.rows.length) throw new HttpError(404, 'not_found', 'Chat not found.');
    return row.rows[0];
  }
  const row = await query(`INSERT INTO public.weeat_chat_sessions (user_id,title) VALUES ($1,$2) RETURNING id,location`,
    [userId, message.slice(0, 60)]);
  return row.rows[0];
}

async function recordUsage(userId, result, trace, round) {
  const prompt = Number(result.usage?.prompt_tokens) || 0, completion = Number(result.usage?.completion_tokens) || 0;
  await query(`INSERT INTO public.weeat_ai_usage (user_id,model,prompt_tokens,completion_tokens) VALUES ($1,$2,$3,$4)`,
    [userId, result.model, prompt, completion]);
  trace.models.push(result.model); trace.promptTokens += prompt; trace.completionTokens += completion;
  trace.steps.push({ t: Date.now() - trace.start, type: 'model', round, model: result.model,
    tokens: [prompt, completion], tool_calls: result.toolCalls.map(call => call.function.name),
    text_chars: result.content.length, failures: result.failures });
}

function chooseCards(turn, markers, answer) {
  const places = turn.places || [];
  const valid = [...new Set(markers.numbers)].filter(number => Number.isInteger(number) && number >= 1 && number <= places.length);
  if (valid.length) return { references: valid.map(number => places[number - 1]), chosen: 'marked' };
  if (markers.none) return { references: [], chosen: 'none_fit' };
  const named = places.filter((_, index) => {
    const name = fold(turn.placeNames?.[index]); return name && fold(answer).includes(name);
  });
  if (named.length) return { references: named, chosen: 'named' };
  return { references: places, chosen: 'all' };
}

async function followUps(question, answer, references, turn, language, trace, messageId, emit, signal) {
  if (turn.locationPrompt || signal?.aborted) return;
  const prompt = followupText
    .replaceAll('${lang === "vi" ? "Vietnamese" : "English"}', language === 'vi' ? 'Vietnamese' : 'English')
    .replaceAll("${lang==='vi'?'Vietnamese':'English'}", language === 'vi' ? 'Vietnamese' : 'English');
  const begin = Date.now();
  try {
    const result = await complete({ messages: [{ role: 'system', content: prompt },
      { role: 'user', content: JSON.stringify({ user_question: question, assistant_answer: answer.slice(0, 600),
        places_shown: references.map(ref => {
          const i = turn.places.findIndex(item => item.video_id === ref.video_id && item.restaurant_id === ref.restaurant_id);
          return turn.placeNames?.[i] || '';
        }) }) }], maxTokens: 300, signal });
    await recordUsage(turn.userId, result, trace, 'follow_ups');
    const json = result.content.match(/\{[\s\S]*\}/)?.[0];
    const raw = json ? JSON.parse(json).questions : [];
    const questions = [...new Set((Array.isArray(raw) ? raw : []).filter(item => typeof item === 'string')
      .map(item => item.trim()).filter(item => item.length >= 3 && item.length <= 80))].slice(0, 3);
    if (questions.length) {
      await query(`UPDATE public.weeat_chat_messages SET ui=jsonb_set(coalesce(ui,'{}'::jsonb),'{suggestions}',$2::jsonb)
        WHERE id=$1`, [messageId, JSON.stringify(questions)]);
      emit('suggestions', { questions });
    }
    trace.steps.push({ type: 'follow_ups', ms: Date.now() - begin, questions });
  } catch (error) { trace.steps.push({ type: 'follow_ups_failed', error: error.name || 'error' }); }
}

export async function runAsk(user, input, emit, signal) {
  const message = typeof input?.message === 'string' ? input.message.trim() : '';
  if (!message || message.length > 1000) throw new HttpError(400, 'bad_request', 'Enter a message of 1–1000 characters.');
  if (!llmConfigured()) throw new HttpError(503, 'ai_unavailable', 'Ask AI is unavailable.');
  const userId = Number(user.uid), language = vi(message) ? 'vi' : 'en';
  await enforceLimits(userId);
  const session = await openSession(userId, message, input.session_id);
  const trace = startTrace(userId, session.id, message);
  let answer = '';
  try {
    let location = input.location ? await resolveLocation(input.location) : session.location;
    if (input.location) {
      await query('UPDATE public.weeat_chat_sessions SET location=$2 WHERE id=$1', [session.id, location]);
      trace.steps.push({ type: 'location_chosen', label: location.label, resolved: location.resolved });
    }
    await query(`INSERT INTO public.weeat_chat_messages (session_id,role,content) VALUES ($1,'user',$2)`, [session.id, message]);
    try { if (await ensureIndexFresh(userId)) trace.steps.push({ type: 'index_refreshed' }); }
    catch (error) { console.warn('ask index freshness check failed:', error.code || error.name); }
    const [history, memories, categories] = await Promise.all([
      query(`SELECT role,content FROM (SELECT role,content,created_at FROM public.weeat_chat_messages
        WHERE session_id=$1 ORDER BY created_at DESC LIMIT 12) h ORDER BY created_at`, [session.id]),
      query('SELECT text FROM public.weeat_user_memory WHERE user_id=$1 ORDER BY created_at DESC LIMIT 30', [userId]),
      categoryLegend(),
    ]);
    emit('session', { session_id: session.id });
    if (input.location) emit('location', location);
    emit('status', { state: 'thinking' });
    const replyIn = language === 'vi' ? 'Vietnamese.' :
      "the language the user's latest message is written in: English, unless it is Vietnamese typed without accents. Never answer an English question in Vietnamese.";
    const messages = [{ role: 'system', content: SYSTEM(memories.rows, new Date().toISOString().slice(0, 10), replyIn, categories) },
      ...history.rows.map(row => ({ role: row.role, content: row.content }))];
    const turn = { userId, sessionId: session.id, places: [], placeNames: [], searched: false, location,
      context: { home: null, memory: [] }, locationPrompt: false, memorySaved: false };
    const markers = markerFilter(value => {
      if (trace.firstDeltaMs === null) trace.firstDeltaMs = Date.now() - trace.start;
      emit('delta', { text: value });
    });
    for (let round = 0; round <= 4; round++) {
      let result, args, retried = false, excluded = new Set();
      while (true) {
        result = await complete({ messages, tools: round < 4 ? TOOL_SPECS : undefined,
          signal, onText: value => markers.write(value) }, { exclude: excluded });
        await recordUsage(userId, result, trace, round);
        try { args = result.toolCalls.map(call => JSON.parse(call.function.arguments || '{}')); break; }
        catch {
          trace.steps.push({ type: 'invalid_tool_arguments', model: result.model });
          if (retried || excluded.size + 1 >= config.models.length) { args = []; break; }
          excluded.add(result.model); retried = true;
        }
      }
      markers.flush();
      if (!result.toolCalls.length || !args.length) break;
      messages.push({ role: 'assistant', content: result.content || null, tool_calls: result.toolCalls });
      for (let i = 0; i < result.toolCalls.length; i++) {
        const call = result.toolCalls[i], began = Date.now();
        let data;
        try {
          data = await runTool(call.function.name, args[i], turn);
          trace.steps.push({ type: 'tool', name: call.function.name, args: args[i], ms: Date.now() - began,
            result: summarizeResult(call.function.name, data) });
        } catch (error) {
          data = { error: 'tool_failed' };
          trace.steps.push({ type: 'tool_error', name: call.function.name, error: error.code || error.name });
        }
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(data) });
      }
    }
    answer = markers.text;
    if (!answer.trim()) { answer = fallback(language, turn.searched); emit('delta', { text: answer }); }
    const cards = chooseCards(turn, markers, answer);
    emit('references', { references: cards.references });
    if (turn.locationPrompt) emit('location_prompt', {});
    const stored = await query(`INSERT INTO public.weeat_chat_messages (session_id,role,content,refs,ui)
      VALUES ($1,'assistant',$2,$3,$4) RETURNING id`, [session.id, answer, JSON.stringify(cards.references),
      turn.locationPrompt ? JSON.stringify({ location_prompt: true }) : null]);
    await query('UPDATE public.weeat_chat_sessions SET updated_at=now() WHERE id=$1', [session.id]);
    const messageId = stored.rows[0].id;
    emit('done', { message_id: messageId, memory_saved: turn.memorySaved });
    trace.steps.push({ type: 'answer', chars: answer.length, cards_of: turn.places.length,
      cards: cards.references.length, cards_chosen: cards.chosen, memory_saved: turn.memorySaved,
      location_prompt: turn.locationPrompt });
    await followUps(message, answer, cards.references, turn, language, trace, messageId, emit, signal);
    try { await recordTrace(trace, { status: signal?.aborted ? 'aborted' : 'ok', answer }); }
    catch (error) { console.warn('ask trace failed:', error.code || error.name); }
    return { answer, references: cards.references, session_id: session.id };
  } catch (error) {
    trace.steps.push({ type: 'error', code: error.code || error.name });
    try { await recordTrace(trace, { status: signal?.aborted ? 'aborted' : 'error', answer, error: error.message }); }
    catch (traceError) { console.warn('ask trace failed:', traceError.code || traceError.name); }
    if (error instanceof HttpError) throw error;
    throw new HttpError(502, 'ai_failed', fallback(language, false));
  }
}

export async function listSessions(userId) {
  const sessions = (await query(`SELECT id,user_id AS uid,title,created_at,updated_at FROM public.weeat_chat_sessions
    WHERE user_id=$1 ORDER BY updated_at DESC LIMIT 30`, [userId])).rows;
  if (!sessions.length) return { sessions: [] };
  const messages = (await query(`SELECT * FROM (SELECT m.id,m.session_id,m.role,m.content,m.refs,m.ui,m.created_at,
    row_number() OVER (PARTITION BY m.session_id ORDER BY m.created_at DESC) AS n
    FROM public.weeat_chat_messages m WHERE m.session_id=ANY($1::uuid[])) x WHERE n<=100
    ORDER BY created_at`, [sessions.map(item => item.id)])).rows;
  return { sessions: sessions.map(session => ({ ...session, messages: messages.filter(item => item.session_id === session.id)
    .map(({ refs, n, ...item }) => ({ ...item, tool_trace: refs?.length ? { references: refs } : null })) })) };
}

export async function deleteSession(userId, id) {
  if (!UUID.test(id)) throw new HttpError(404, 'not_found', 'Chat not found.');
  const result = await query('DELETE FROM public.weeat_chat_sessions WHERE id=$1 AND user_id=$2', [id, userId]);
  if (!result.rowCount) throw new HttpError(404, 'not_found', 'Chat not found.');
  return { ok: true };
}

export async function listMemory(userId) {
  const rows = await query(`SELECT id,kind,text,created_at FROM public.weeat_user_memory
    WHERE user_id=$1 ORDER BY created_at DESC LIMIT 30`, [userId]);
  return { memories: rows.rows };
}

export async function deleteMemory(userId, id) {
  if (!UUID.test(id)) throw new HttpError(404, 'not_found', 'Memory not found.');
  const result = await query('DELETE FROM public.weeat_user_memory WHERE id=$1 AND user_id=$2', [id, userId]);
  if (!result.rowCount) throw new HttpError(404, 'not_found', 'Memory not found.');
  return { ok: true };
}
