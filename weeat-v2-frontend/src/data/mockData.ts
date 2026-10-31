import fixtures from './fixtures.json' with {type:'json'};
import type { Profile,Restaurant,Snapshot,SourceVideo } from '../types';

export const demoHome=fixtures.addresses[0].label;
export const restaurants=fixtures.restaurants as Restaurant[];
export const categories=fixtures.categories;
export function createInitialData():Snapshot{return {
  profile:{...fixtures.profile[0]} as Profile,
  restaurants:restaurants.map(r=>({...r})),
  videos:(fixtures.videos as SourceVideo[]).map(v=>({...v})),
  sessions:[],activeSession:null,
};}
