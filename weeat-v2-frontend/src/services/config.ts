const env = import.meta.env || ({} as ImportMetaEnv);
export const config = {
  mode: (env.PROD ? 'live' : env.VITE_API_MODE || (env.VITE_API_BASE_URL ? 'live' : 'mock')) as 'live'|'mock',
  base: (env.VITE_API_BASE_URL || '').trim().replace(/\/+$/, ''),
  testAuth: env.DEV && env.VITE_ENABLE_TEST_AUTH === 'true',
};
if (!['live','mock'].includes(config.mode)) throw new Error('Invalid VITE_API_MODE');
export const isMock = env.DEV && config.mode === 'mock';
