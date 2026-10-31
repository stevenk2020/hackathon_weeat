export const parseKeys = value => [...new Set(String(value || '').split(',').map(key => key.trim()).filter(Boolean))];
export const keyTag = key => `…${String(key).slice(-4)}`;

export class KeyError extends Error {
  constructor(message, cooldownMs) {
    super(message);
    this.name = 'KeyError';
    this.cooldownMs = cooldownMs ?? (/\b(?:401|403)\b|REQUEST_DENIED/i.test(message) ? 3_600_000 : 60_000);
  }
}

export function createKeyPool(values, { now = Date.now, attempts = 3 } = {}) {
  const keys = [...new Set(values.filter(Boolean))].map(key => ({ key, calls: 0, failures: 0, until: 0 }));
  let cursor = 0;
  const size = keys.length;
  const pick = excluded => {
    if (!size) return null;
    for (let offset = 0; offset < size; offset++) {
      const index = (cursor + offset) % size;
      const entry = keys[index];
      if (!excluded.has(entry) && entry.until <= now()) {
        cursor = (index + 1) % size;
        return entry;
      }
    }
    const resting = keys.filter(entry => !excluded.has(entry)).sort((a, b) => a.until - b.until)[0];
    if (resting) cursor = (keys.indexOf(resting) + 1) % size;
    return resting || null;
  };
  const rest = (entry, reason, baseMs) => {
    entry.failures++;
    const duration = Math.min(21_600_000, baseMs * 2 ** (entry.failures - 1));
    entry.until = now() + duration;
    const safeReason = /429/.test(reason) ? 'HTTP 429' : /401/.test(reason) ? 'HTTP 401' :
      /403/.test(reason) ? 'HTTP 403' : 'provider refusal';
    console.warn(`goong: key ${keyTag(entry.key)} resting ${Math.ceil(duration / 1000)}s (${safeReason})`);
  };
  return {
    size,
    acquire() { const entry = pick(new Set()); if (!entry) return null; entry.calls++; return entry.key; },
    keyByTag(tag) { return keys.find(entry => keyTag(entry.key) === tag)?.key || null; },
    restByTag(tag, reason, baseMs = 60_000) {
      const entry = keys.find(item => keyTag(item.key) === tag);
      if (!entry) return false;
      rest(entry, reason, baseMs);
      return true;
    },
    stats() { return keys.map(entry => ({ key: keyTag(entry.key), calls: entry.calls,
      failures: entry.failures, resting_s: Math.max(0, Math.ceil((entry.until - now()) / 1000)) })); },
    async run(work) {
      if (!size) throw new KeyError('No Goong keys available');
      const excluded = new Set();
      let last;
      for (let count = 0; count < Math.min(size, attempts); count++) {
        const entry = pick(excluded);
        if (!entry) break;
        excluded.add(entry);
        entry.calls++;
        try {
          const result = await work(entry.key);
          entry.failures = 0;
          entry.until = 0;
          return result;
        } catch (error) {
          if (!(error instanceof KeyError)) throw error;
          last = error;
          rest(entry, error.message, error.cooldownMs);
        }
      }
      throw last || new KeyError('No Goong keys available');
    },
  };
}
