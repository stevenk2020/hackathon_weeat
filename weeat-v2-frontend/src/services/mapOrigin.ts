import type { Address } from '../types';
import { validAddress } from './domain';

const key = (uid: string | number) => `weeat-map-origin:${uid}`;

export function readMapOrigin(uid: string | number): Address | undefined {
  try {
    const raw = localStorage.getItem(key(uid));
    if (!raw) return undefined;
    const address: unknown = JSON.parse(raw);
    return validAddress(address as Address) ? address as Address : undefined;
  } catch {
    return undefined;
  }
}

export function saveMapOrigin(uid: string | number, address: Address): void {
  if (!validAddress(address)) return;
  try { localStorage.setItem(key(uid), JSON.stringify(address)); } catch { /* optional browser storage */ }
}
