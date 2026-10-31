import copy from './copy.json' with {type:'json'};
export const vi=Object.fromEntries(Object.entries(copy).map(([key,value])=>[key,value.vi])) as Record<string,string>;
