import type { AuthAdapter, AuthUser } from '../types';
import { configureAuth } from './auth';
import { config } from './config';
import { ServiceError } from './errors';

let current: AuthUser | null = null;
const listeners = new Set<(user: AuthUser | null) => void>();
const accept = (user: AuthUser | null) => {
  current = user;
  for (const listener of listeners) listener(user);
};

const adapter: AuthAdapter = {
  currentUser: () => current,
  subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  async signIn() { window.location.assign(`${config.base}/api/auth/google/start`); },
  async signOut() {
    const response = await fetch(`${config.base}/api/auth/logout`, { method: 'POST', credentials: 'include' });
    if (!response.ok) throw new ServiceError('AUTH', 'Could not sign out.', response.status);
    accept(null);
  },
};

export async function configureAuthentication(): Promise<void> {
  try {
    const response = await fetch(`${config.base}/api/auth/me`, { credentials: 'include', signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new ServiceError('AUTH', 'Could not restore the session.', response.status);
    const data: unknown = await response.json();
    const user = (data as { user?: { uid?: unknown; email?: unknown } })?.user;
    if (user && (typeof user.uid === 'string' || typeof user.uid === 'number') && typeof user.email === 'string') {
      accept({ uid: String(user.uid), email: user.email, getIdToken: async () => '' });
    } else accept(null);
  } catch { accept(null); }
  configureAuth(adapter);
}
