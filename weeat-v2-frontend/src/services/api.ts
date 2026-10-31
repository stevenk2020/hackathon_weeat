import { request } from './apiClient';
import * as c from './contracts';
import { identity } from './domain';
import { ServiceError } from './errors';
import { isMock } from './config';
import { initialUser } from './auth';
import type { AuthUser,Edits,Profile,Restaurant } from '../types';
import type { SourceVideo } from '../types';
async function saveRestaurant(user:AuthUser,r:Restaurant,saved:boolean):Promise<0|1>;
async function saveRestaurant(r:Restaurant,saved:0|1):Promise<0|1>;
async function saveRestaurant(first:AuthUser|Restaurant,second:Restaurant|0|1,third?:boolean):Promise<0|1>{
  const direct=typeof second==='number';
  const user=direct?(typeof window!=='undefined'?initialUser():null):first as AuthUser;
  if(!user)throw new ServiceError('AUTH');
  const r=direct?first as Restaurant:second as Restaurant;
  const saved=direct?second===1:third===true;
  const data=c.object(await request(`/api/library/${encodeURIComponent(r.video_id)}/${encodeURIComponent(r.restaurant_id)}/save`,saved?'PUT':'DELETE',undefined,user));
  if(data.is_saved!==(saved?1:0))throw new ServiceError('INVALID_RESPONSE');
  return data.is_saved as 0|1;
}
async function editRestaurant(user:AuthUser,r:Restaurant,edits:Edits):Promise<Restaurant>;
async function editRestaurant(r:Restaurant,edits:Edits):Promise<Restaurant>;
async function editRestaurant(first:AuthUser|Restaurant,second:Restaurant|Edits,third?:Edits):Promise<Restaurant>{
  const direct=third===undefined;
  const user=direct?(typeof window!=='undefined'?initialUser():null):first as AuthUser;
  if(!user)throw new ServiceError('AUTH');
  const r=direct?first as Restaurant:second as Restaurant;
  const edits=direct?second as Edits:third!;
  const next=c.restaurant(c.object(await request(`/api/library/${encodeURIComponent(r.video_id)}/${encodeURIComponent(r.restaurant_id)}`,'PATCH',{edits},user)).restaurant,user.uid);
  if(identity(next)!==identity(r))throw new ServiceError('INVALID_RESPONSE');
  return next;
}
export const api = {
  async samples(){const data=c.object(await request('/api/samples'));return Array.isArray(data.videos)?data.videos as (SourceVideo&{place_count?:number})[]:[];},
  async categories(){return c.categories(c.object(await request('/api/categories')).categories);},
  async profile(user:AuthUser){return c.profile(c.object(await request('/api/profile','GET',undefined,user)).profile,user.uid);},
  async updateProfile(user:AuthUser,patch:Partial<Profile>){return c.profile(c.object(await request('/api/profile','PATCH',patch,user)).profile,user.uid);},
  async analyze(url:string,user?:AuthUser){const current=user||(typeof window!=='undefined'?initialUser():null);if(!current)throw new ServiceError('AUTH','Sign in before continuing.');return c.analysis(await request('/api/analyze','POST',{url},current),current.uid,!isMock);},
  async library(user:AuthUser,q='',category:number|null=null,signal?:AbortSignal){const params=new URLSearchParams({q});if(category!==null)params.set('cate_id',String(category));const data=c.object(await request(`/api/library?${params}`,'GET',undefined,user,signal));if(!Array.isArray(data.restaurants))throw new ServiceError('INVALID_RESPONSE');return [...new Map(data.restaurants.map(x=>{const r=c.restaurant(x,user.uid);return [identity(r),r] as const;})).values()].filter(r=>r.is_saved===1);},
  save:saveRestaurant,
  edit:editRestaurant,
  async ask(user:AuthUser,message:string,session_id?:string){return c.askResponse(await request('/api/ask','POST',{message,...(session_id?{session_id}:{})},user));},
};
