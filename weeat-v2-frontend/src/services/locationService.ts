import fixtures from '../data/fixtures.json';
import type { Address } from '../types';
import { isMock } from './config';
import { ServiceError } from './errors';
import { fold, distance } from './domain';
import { request } from './apiClient';

export type AddressOption = Address | { id:string; ref:string; label:string };
const mockAddresses = fixtures.addresses as Address[];
const object = (value:unknown):Record<string,unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string,unknown> : {};
const validCoordinate = (value:unknown,limit:number) => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit;
const addressFrom = (value:unknown):Address => {
  const row=object(value);
  if(typeof row.label !== 'string' || !row.label.trim() ||
    !validCoordinate(row.latitude,90) || !validCoordinate(row.longitude,180) ||
    !['goong','vietmap'].includes(String(row.provider))) throw new ServiceError('addressLookupError');
  return {id:String(row.id||row.ref||'api'),label:row.label,latitude:row.latitude as number,
    longitude:row.longitude as number,provider:'api',source:row.provider as 'goong'|'vietmap'};
};

export async function searchAddresses(query:string,sessionToken=''):Promise<AddressOption[]> {
  const q=query.trim();
  if(q.length<(/[0-9]/.test(q)?3:4))return [];
  if(isMock){await new Promise(resolve=>setTimeout(resolve,180));const words=fold(q).split(/\s+/);return mockAddresses.filter(address=>words.every(word=>fold(address.label).includes(word)));}
  try {
    const params=new URLSearchParams({q,st:sessionToken});
    const response=object(await request(`/api/geo/search?${params}`));
    if(!Array.isArray(response.suggestions))throw new ServiceError('addressLookupError');
    return response.suggestions.map(value=>{const row=object(value);return {id:String(row.id||''),ref:String(row.ref||''),label:String(row.label||'')};})
      .filter(row=>row.id&&row.ref&&row.label);
  }catch{throw new ServiceError('addressLookupError');}
}

export async function resolveAddress(ref:string,sessionToken=''):Promise<Address> {
  try {
    const params=new URLSearchParams({ref,st:sessionToken});
    const response=object(await request(`/api/geo/place?${params}`));
    return addressFrom(response.address);
  }catch{throw new ServiceError('addressLookupError');}
}

export async function reverseAddress(latitude:number,longitude:number):Promise<Address> {
  try {
    const params=new URLSearchParams({lat:String(latitude),lng:String(longitude)});
    const response=object(await request(`/api/geo/reverse?${params}`));
    return addressFrom(response.address);
  }catch{throw new ServiceError('locationUnavailable');}
}

export async function currentLocation():Promise<Address> {
  if(!navigator.geolocation)throw new ServiceError('locationUnavailable');
  const coordinates=await new Promise<{latitude:number;longitude:number}>((resolve,reject)=>
    navigator.geolocation.getCurrentPosition(position=>resolve({latitude:position.coords.latitude,longitude:position.coords.longitude}),
      error=>reject(new ServiceError(error.code===1?'locationDenied':'locationUnavailable')),
      {enableHighAccuracy:true,timeout:10000,maximumAge:60000}));
  if(!isMock)return reverseAddress(coordinates.latitude,coordinates.longitude);
  const nearest=[...mockAddresses].sort((a,b)=>distance(coordinates,a)-distance(coordinates,b))[0];
  if(distance(coordinates,nearest)>5)throw new ServiceError('locationUnavailable');
  return {...nearest,id:'gps',...coordinates};
}
