import { isMock } from './config';
import { ServiceError } from './errors';
export interface Memory {id:string;text:string;user_id:string}
const key=(uid:string)=>`weeat-ai-memories:${uid}`;
export const memoryNormalize=(v:string)=>v.normalize('NFKC').toLowerCase().replace(/[’‘]/g,"'").replace(/doesn't/g,'does not').replace(/don't/g,'do not').replace(/[.!?]+$/,'').replace(/\s+/g,' ').trim();
export function readMemories(uid:string):Memory[]{if(!import.meta.env.DEV || !isMock)throw new ServiceError('memoryUnavailable');try{const k=key(uid);let rows=JSON.parse(localStorage.getItem(k)||'[]') as Memory[];if(!Array.isArray(rows))throw Error();if(!localStorage.getItem(`${k}:demo-initialized`)){if(!rows.length){rows=[{id:crypto.randomUUID(),text:'I like hot spicy food',user_id:uid}];localStorage.setItem(k,JSON.stringify(rows));}localStorage.setItem(`${k}:demo-initialized`,'1');}return rows.filter(r=>r.user_id===uid&&typeof r.text==='string');}catch{throw new ServiceError('memoryStorageError');}}
function write(uid:string,rows:Memory[]){try{localStorage.setItem(key(uid),JSON.stringify(rows));window.dispatchEvent(new Event('weeat-memory'));}catch{throw new ServiceError('memoryStorageError');}}
export function remember(uid:string,text:string){const rows=readMemories(uid),existing=rows.find(r=>memoryNormalize(r.text)===memoryNormalize(text));if(existing)return {existing:true,text:existing.text};write(uid,[...rows,{id:crypto.randomUUID(),text,user_id:uid}]);return {existing:false,text};}
export function deleteMemory(uid:string,id:string){write(uid,readMemories(uid).filter(r=>r.id!==id));}
