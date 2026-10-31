import { config } from './config';
import { ServiceError } from './errors';
import type { Reference } from '../types';

export type AskStreamEvent =
  | { type: 'session'; session_id: string }
  | { type: 'status'; state: string }
  | { type: 'delta'; text: string }
  | { type: 'references'; references: Reference[] }
  | { type: 'done'; message_id: string }
  | { type: 'suggestions'; questions: string[] }
  | { type: 'location' | 'location_prompt'; data: Record<string, unknown> };

function parseEvent(name: string, value: unknown): AskStreamEvent | null {
  if (!value || typeof value !== 'object') throw new ServiceError('INVALID_RESPONSE');
  const data = value as Record<string, unknown>;
  if (name === 'error') throw new ServiceError(String(data.code || 'ai_failed'), String(data.message || 'Ask AI failed.'));
  if (name === 'session' && typeof data.session_id === 'string') return { type: 'session', session_id: data.session_id };
  if (name === 'status' && typeof data.state === 'string') return { type: 'status', state: data.state };
  if (name === 'delta' && typeof data.text === 'string') return { type: 'delta', text: data.text };
  if (name === 'references' && Array.isArray(data.references)) {
    const references = data.references.map(item => {
      if (!item || typeof item !== 'object') throw new ServiceError('INVALID_RESPONSE');
      const ref = item as Record<string, unknown>;
      if (typeof ref.video_id !== 'string' || typeof ref.restaurant_id !== 'string') throw new ServiceError('INVALID_RESPONSE');
      return { video_id: ref.video_id, restaurant_id: ref.restaurant_id };
    });
    return { type: 'references', references };
  }
  if (name === 'done' && typeof data.message_id === 'string') return { type: 'done', message_id: data.message_id };
  if (name === 'suggestions' && Array.isArray(data.questions))
    return { type: 'suggestions', questions: data.questions.filter((item): item is string => typeof item === 'string') };
  if (name === 'location' || name === 'location_prompt') return { type: name, data };
  if (['session', 'status', 'delta', 'references', 'done'].includes(name)) throw new ServiceError('INVALID_RESPONSE');
  return null;
}

export async function streamAsk(
  input: { message: string; session_id?: string },
  onEvent: (event: AskStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(`${config.base}/api/ask/stream`, {
    method: 'POST', credentials: 'include', signal,
    headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    let error: { error?: { code?: string; message?: string } } = {};
    try { error = await response.json(); } catch { /* Keep the HTTP status below. */ }
    throw new ServiceError(error.error?.code || 'HTTP_ERROR', error.error?.message || response.statusText, response.status);
  }
  if (!response.headers.get('content-type')?.toLowerCase().includes('text/event-stream') || !response.body)
    throw new ServiceError('INVALID_RESPONSE');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '', done = false;
  const dispatch = (frame: string) => {
    let name = 'message';
    const data: string[] = [];
    for (const line of frame.split(/\r?\n/)) {
      if (line.startsWith(':')) continue;
      const colon = line.indexOf(':');
      const field = colon < 0 ? line : line.slice(0, colon);
      const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
      if (field === 'event') name = value;
      if (field === 'data') data.push(value);
    }
    if (!data.length) return;
    let parsed: unknown;
    try { parsed = JSON.parse(data.join('\n')); } catch { throw new ServiceError('INVALID_RESPONSE'); }
    const event = parseEvent(name, parsed);
    if (event) {
      if (event.type === 'done') done = true;
      onEvent(event);
    }
  };
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      if (buffer.length > 2_000_000) throw new ServiceError('INVALID_RESPONSE');
      let boundary: RegExpExecArray | null;
      while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
        dispatch(buffer.slice(0, boundary.index));
        buffer = buffer.slice(boundary.index + boundary[0].length);
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) dispatch(buffer);
    if (!done) throw new ServiceError('INVALID_RESPONSE', 'Ask AI stopped before completing its answer.');
  } finally { reader.releaseLock(); }
}
