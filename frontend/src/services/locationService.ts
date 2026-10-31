import fixtures from '../data/fixtures.json';
import type { Address } from '../types';
import { isMock } from './config';
import { ServiceError } from './errors';
import { fold,distance } from './domain';
export async function searchAddresses(query:string):Promise<Address[]>{if(!import.meta.env.DEV || !isMock)throw new ServiceError('locationBlocked');await new Promise(r=>setTimeout(r,180));const words=fold(query).trim().split(/\s+/);return (fixtures.addresses as Address[]).filter(a=>words.every(w=>fold(a.label).includes(w)));}
export async function currentLocation():Promise<Address>{if(!import.meta.env.DEV || !isMock)throw new ServiceError('locationBlocked');if(!navigator.geolocation)throw new ServiceError('locationUnavailable');return new Promise((resolve,reject)=>navigator.geolocation.getCurrentPosition(p=>{const coords={latitude:p.coords.latitude,longitude:p.coords.longitude};const nearest=[...(fixtures.addresses as Address[])].sort((a,b)=>distance(coords,a)-distance(coords,b))[0];if(distance(coords,nearest)>5){reject(new ServiceError('locationUnavailable'));return;}resolve({...nearest,id:'gps',...coords});},e=>reject(new ServiceError(e.code===1?'locationDenied':'locationUnavailable')),{enableHighAccuracy:true,timeout:10000,maximumAge:60000}));}
