import { config,isMock } from './config';
import { ServiceError } from './errors';
import type { AuthUser } from '../types';
export async function request(path:string,method='GET',body?:unknown,user?:AuthUser|null,signal?:AbortSignal):Promise<unknown> {
  if(import.meta.env.DEV && isMock){const {mockRequest}=await import('./mockServer');return mockRequest(path,method,body,user,signal);}
  const controller=new AbortController();const abort=()=>controller.abort(signal?.reason);signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  const timer=setTimeout(()=>controller.abort('timeout'),path==='/api/analyze'?180000:15000);
  try { const response=await fetch(config.base+path,{method,credentials:'include',headers:{Accept:'application/json',...(body!==undefined?{'Content-Type':'application/json'}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:controller.signal});let data:unknown;try{data=await response.json();}catch{throw new ServiceError(response.ok?'INVALID_RESPONSE':'HTTP_ERROR',response.ok?'INVALID_RESPONSE':response.statusText,response.status);}if(!response.ok){const err=(data as {error?:{code?:string;message?:string}})?.error;throw new ServiceError(err?.code||'HTTP_ERROR',err?.message||response.statusText,response.status);}return data; }catch(e){if(controller.signal.aborted&&!signal?.aborted)throw new ServiceError('TIMEOUT');throw e;}finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
