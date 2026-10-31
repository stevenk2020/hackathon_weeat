import type { AuthAdapter,AuthUser } from '../types';
import { isMock } from './config';
import { ServiceError } from './errors';
let adapter: AuthAdapter|null=null;
export function configureAuth(value:AuthAdapter) {adapter=value;window.dispatchEvent(new Event('weeat-auth-adapter'));}
export const getAuthAdapter=()=>adapter;
export function demoUser(uid='1',email='le.hoang@gmail.com'):AuthUser {if(!import.meta.env.DEV || !isMock)throw new ServiceError('AUTH');return {uid,email,getIdToken:async()=>`development-only-${uid}`};}
export function initialUser():AuthUser|null {if(!import.meta.env.DEV || !isMock)return adapter?.currentUser()||null;try{const u=JSON.parse(sessionStorage.getItem('weeat-v2-session-v1')||'null');return u?demoUser(u.uid,u.email):null;}catch{return null;}}
