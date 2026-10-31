import { config } from './config.mjs';

const cooldown = new Map();
const noReasoning = new Set();

export class LlmError extends Error {
  constructor(message, { status = 502, retryable = true, failures = [] } = {}) {
    super(message); this.name = 'LlmError'; this.status = status; this.retryable = retryable; this.failures = failures;
  }
}

export const llmConfigured = () => Boolean(config.openaiApiKey && config.models?.length);

function candidates(exclude) {
  const available = config.models.filter(model => !exclude?.has(model));
  const ready = available.filter(model => (cooldown.get(model) || 0) <= Date.now());
  return ready.length ? ready : available.slice(0, 1);
}

async function readStream(response, onText) {
  if (!response.body) throw new Error('Empty model response');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const calls = new Map();
  let buffer = '', content = '', usage = {}, streamedText = false;
  const parse = line => {
    if (!line.startsWith('data:')) return;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') return;
    const event = JSON.parse(data);
    if (event.usage) usage = event.usage;
    for (const choice of event.choices || []) {
      const delta = choice.delta || {};
      for (const part of delta.tool_calls || []) {
        const call = calls.get(part.index) || { id: '', type: 'function', function: { name: '', arguments: '' } };
        if (part.id) call.id += part.id;
        if (part.function?.name) call.function.name += part.function.name;
        if (part.function?.arguments) call.function.arguments += part.function.arguments;
        calls.set(part.index, call);
      }
      if (typeof delta.content === 'string' && !calls.size) {
        content += delta.content;
        if (delta.content && onText) { streamedText = true; onText(delta.content); }
      }
    }
  };
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    let boundary;
    while ((boundary = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, boundary).replace(/\r$/, '');
      buffer = buffer.slice(boundary + 1);
      parse(line);
    }
    if (done) break;
  }
  if (buffer) parse(buffer);
  return { content, toolCalls: [...calls.entries()].sort(([a], [b]) => a - b).map(([, call]) => call), usage, streamedText };
}

async function request(model, options, reasoning) {
  const body = { model, messages: options.messages, stream: true, stream_options: { include_usage: true },
    max_completion_tokens: options.maxTokens || 2500 };
  if (options.tools?.length) { body.tools = options.tools; body.tool_choice = 'auto'; }
  if (reasoning !== undefined && reasoning !== '') body.reasoning_effort = reasoning;
  const headers = { Authorization: `Bearer ${config.openaiApiKey}`, 'Content-Type': 'application/json' };
  if (config.openaiTrackingKeyId && config.openaiTrackingHeader) headers[config.openaiTrackingHeader] = config.openaiTrackingKeyId;
  const response = await fetch(`${config.openaiBaseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST', headers, body: JSON.stringify(body), signal: options.signal
      ? AbortSignal.any([options.signal, AbortSignal.timeout(config.askTimeoutMs)]) : AbortSignal.timeout(config.askTimeoutMs),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    const error = new LlmError(`Model HTTP ${response.status}`, { status: response.status,
      retryable: response.status !== 401 });
    error.detail = detail;
    throw error;
  }
  return readStream(response, options.onText);
}

export async function complete(options, { exclude } = {}) {
  if (!llmConfigured()) throw new LlmError('Ask AI is not configured', { status: 503, retryable: false });
  const failures = [];
  let lastError;
  for (const model of candidates(exclude)) {
    let sentText = false;
    try {
      let result;
      const requestOptions = { ...options, onText: options.onText
        ? value => { sentText = true; options.onText(value); } : undefined };
      try { result = await request(model, requestOptions, noReasoning.has(model) ? '' : config.reasoningEffort); }
      catch (error) {
        if (error.status === 400 && /reasoning_effort/i.test(error.detail || '')) {
          noReasoning.add(model);
          result = await request(model, requestOptions, '');
        } else throw error;
      }
      return { ...result, model, failures };
    } catch (error) {
      lastError = error;
      failures.push({ model, status: error.status || 502 });
      if (error.status === 401 || error.name === 'AbortError' || sentText)
        throw new LlmError(error.message, { status: error.status || 502, retryable: false, failures });
      const long = [400, 403, 404].includes(error.status);
      cooldown.set(model, Date.now() + (long ? 600_000 : 60_000));
      console.warn(`ask: model ${model} failed (${error.status || error.name || 'network'}); trying next`);
    }
  }
  throw new LlmError(lastError?.message || 'All models failed', { status: lastError?.status || 502,
    retryable: true, failures });
}

export async function embed(inputs, signal) {
  if (!llmConfigured()) throw new LlmError('Ask AI is not configured', { status: 503, retryable: false });
  const response = await fetch(`${config.openaiBaseUrl.replace(/\/$/, '')}/embeddings`, {
    method: 'POST', headers: { Authorization: `Bearer ${config.openaiApiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: config.embedModel, input: inputs }), signal: signal || AbortSignal.timeout(config.askTimeoutMs),
  });
  if (!response.ok) throw new LlmError(`Embedding HTTP ${response.status}`, { status: response.status });
  return (await response.json()).data.map(row => row.embedding);
}
