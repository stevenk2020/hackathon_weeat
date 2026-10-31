let position=0;
export function rememberDiscoverScroll(y:number){position=Math.max(0,y);}
export function readDiscoverScroll(){return position;}
