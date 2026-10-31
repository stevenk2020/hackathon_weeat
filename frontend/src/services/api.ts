import { request } from './apiClient';
import * as c from './contracts';
import { identity } from './domain';
import { ServiceError } from './errors';
import type { AuthUser,Edits,Profile,Restaurant } from '../types';
export const api = {
  async categories(){return c.categories(c.object(await request('/api/categories')).categories);},
  async profile(user:AuthUser){return c.profile(c.object(await request('/api/profile','GET',undefined,user)).profile,user.uid);},
  async updateProfile(user:AuthUser,patch:Partial<Profile>){return c.profile(c.object(await request('/api/profile','PATCH',patch,user)).profile,user.uid);},
  async analyze(user:AuthUser,url:string){return c.analysis(await request('/api/analyze','POST',{url},user),user.uid);},
  async library(user:AuthUser,q='',category:number|null=null,signal?:AbortSignal){const params=new URLSearchParams({q});if(category!==null)params.set('cate_id',String(category));const data=c.object(await request(`/api/library?${params}`,'GET',undefined,user,signal));if(!Array.isArray(data.restaurants))throw new ServiceError('INVALID_RESPONSE');return [...new Map(data.restaurants.map(x=>{const r=c.restaurant(x,user.uid);return [identity(r),r] as const;})).values()].filter(r=>r.is_saved===1);},
  async save(user:AuthUser,r:Restaurant,saved:boolean){const data=c.object(await request(`/api/library/${encodeURIComponent(r.video_id)}/${encodeURIComponent(r.restaurant_id)}/save`,saved?'PUT':'DELETE',undefined,user));if(data.is_saved!==(saved?1:0))throw new ServiceError('INVALID_RESPONSE');return data.is_saved as 0|1;},
  async edit(user:AuthUser,r:Restaurant,edits:Edits){const next=c.restaurant(c.object(await request(`/api/library/${encodeURIComponent(r.video_id)}/${encodeURIComponent(r.restaurant_id)}`,'PATCH',{edits},user)).restaurant,user.uid);if(identity(next)!==identity(r))throw new ServiceError('INVALID_RESPONSE');return next;},
  async ask(user:AuthUser,message:string,session_id?:string){return c.askResponse(await request('/api/ask','POST',{message,...(session_id?{session_id}:{})},user));},
};
