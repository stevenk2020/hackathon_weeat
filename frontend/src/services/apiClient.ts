import { config,isMock } from './config';
import { ServiceError } from './errors';
import type { AuthUser } from '../types';
export async function request(path:string,method='GET',body?:unknown,user?:AuthUser|null,signal?:AbortSignal):Promise<unknown> {
  if(isMock){const {mockRequest}=await import('./mockServer');return mockRequest(path,method,body,user,signal);}
  if(!config.base)throw new ServiceError('BLOCKED');
  const controller=new AbortController();const abort=()=>controller.abort(signal?.reason);signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  const timer=setTimeout(()=>controller.abort('timeout'),15000);
  try { const token=user?await user.getIdToken():null;const response=await fetch(config.base+path,{method,headers:{Accept:'application/json',...(body!==undefined?{'Content-Type':'application/json'}:{}),...(token?{Authorization:`Bearer ${token}`}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:controller.signal});let data:unknown;try{data=await response.json();}catch{throw new ServiceError('INVALID_RESPONSE');}if(!response.ok){const err=(data as {error?:{code?:string;message?:string}})?.error;throw new ServiceError(err?.code||'HTTP_ERROR',err?.message||response.statusText,response.status);}return data; }catch(e){if(controller.signal.aborted&&!signal?.aborted)throw new ServiceError('TIMEOUT');throw e;}finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
