import copy from './copy.json' with {type:'json'};
export const en=Object.fromEntries(Object.entries(copy).map(([key,value])=>[key,value.en])) as Record<string,string>;
