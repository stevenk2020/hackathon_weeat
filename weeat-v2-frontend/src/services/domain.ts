import type { Address, Restaurant } from '../types';
import { ServiceError } from './errors';
export const identity = (r: Pick<Restaurant,'user_id'|'video_id'|'restaurant_id'>) => JSON.stringify([String(r.user_id),String(r.video_id),String(r.restaurant_id)]);
export const restaurantKey = identity;
export const detailPath = (r: Restaurant) => `/restaurants/${encodeURIComponent(identity(r))}`;
export const mapPath = (r: Restaurant) => `/map?restaurant=${encodeURIComponent(identity(r))}`;
export const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d').replace(/Đ/g,'D').toLowerCase();
export function supportedUrl(raw: string) {
  if (/\s/.test(raw)) throw new ServiceError('urlSingle');
  let u: URL; try { u = new URL(raw); } catch { throw new ServiceError('urlInvalid'); }
  if (u.protocol !== 'https:' || u.username || u.password) throw new ServiceError('urlInvalid');
  const host = u.hostname.toLowerCase();
  const yt = ['youtube.com','www.youtube.com','m.youtube.com'].includes(host) && /^\/shorts\/[\w-]+\/?$/.test(u.pathname);
  const ytShort = ['youtu.be','www.youtu.be'].includes(host) && /^\/[\w-]{11}\/?$/.test(u.pathname);
  const tt = ['tiktok.com','www.tiktok.com','m.tiktok.com'].includes(host) && /^\/@[^/]+\/(?:video|photo)\/\d+\/?$/.test(u.pathname);
  const short = ['vm.tiktok.com','vt.tiktok.com'].includes(host) && /^\/[a-z0-9]+\/?$/i.test(u.pathname);
  if (!yt && !ytShort && !tt && !short) throw new ServiceError('urlUnsupported');
  return { url: u.href, platform: yt || ytShort ? 'youtube' as const : 'tiktok' as const, id: u.pathname.split('/').filter(Boolean).at(-1)! };
}
export function deliveryUrl(r: Restaurant) { if(r.shopeefood_kinds !== 'store' || !r.shopeefood_url) return null; try { const u = new URL(r.shopeefood_url); return u.protocol === 'https:' && !u.username && !u.password && ['shopeefood.vn','www.shopeefood.vn'].includes(u.hostname) && u.pathname.split('/').filter(Boolean).length >= 2 ? u.href : null; } catch { return null; } }
export const validAddress = (a: Address|null): a is Address => !!a && !!a.id && !!a.label.trim() && ['mock','api'].includes(a.provider) && Number.isFinite(a.latitude) && Math.abs(a.latitude)<=90 && Number.isFinite(a.longitude) && Math.abs(a.longitude)<=180;
export const libraryMatches = (r: Restaurant, q: string) => fold([r.restaurant_name,r.dish,r.address].join(' ')).includes(fold(q.trim()));
export function distance(a: Pick<Address,'latitude'|'longitude'>, b: {latitude:number|null;longitude:number|null}) { if(b.latitude === null || b.longitude === null) return Infinity; const rad = Math.PI/180; const dlat=(b.latitude-a.latitude)*rad,dlng=(b.longitude-a.longitude)*rad; const v=Math.sin(dlat/2)**2+Math.cos(a.latitude*rad)*Math.cos(b.latitude*rad)*Math.sin(dlng/2)**2; return 6371*2*Math.atan2(Math.sqrt(v),Math.sqrt(1-v)); }
export function corridor(a: Address,b: Address,r: Restaurant) { if(r.latitude===null||r.longitude===null)return Infinity; const x=(r.longitude-a.longitude)*111.195*Math.cos(a.latitude*Math.PI/180), y=(r.latitude-a.latitude)*111.195; const bx=(b.longitude-a.longitude)*111.195*Math.cos(a.latitude*Math.PI/180),by=(b.latitude-a.latitude)*111.195; const clamp=(v:number,z:number)=>Math.max(Math.min(0,z),Math.min(Math.max(0,z),v)); return Math.min(Math.hypot(x-clamp(x,bx),y),Math.hypot(x-bx,y-clamp(y,by))); }
export const price = (r: Restaurant) => r.price_vnd === null ? null : `${r.price_vnd.toLocaleString('en-US')}${r.price_vnd_max !== null && r.price_vnd_max !== r.price_vnd ? ` – ${r.price_vnd_max.toLocaleString('en-US')}` : ''} VND`;
