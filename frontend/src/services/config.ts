export const config = {
  mode: (import.meta.env.PROD ? 'live' : import.meta.env.VITE_API_MODE || (import.meta.env.VITE_API_BASE_URL ? 'live' : 'mock')) as 'live'|'mock',
  base: (import.meta.env.VITE_API_BASE_URL || '').trim().replace(/\/+$/, ''),
  testAuth: import.meta.env.DEV && import.meta.env.VITE_ENABLE_TEST_AUTH === 'true',
};
if (!['live','mock'].includes(config.mode)) throw new Error('Invalid VITE_API_MODE');
export const isMock = import.meta.env.DEV && config.mode === 'mock';
