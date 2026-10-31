'use strict';
const {plain,withoutFloor,streetOf}=require('./records');const {clean}=require('./upstream');
function createLookup(c,p,now){const points=new Map(),stores=new Map(),blocked=new Map(),last=new Map();const words=s=>plain(s).split(' ').filter(w=>w&&w!=='/');const valid=p=>p&&Number.isFinite(p.lat)&&Number.isFinite(p.lng)&&Math.abs(p.lat)<=90&&Math.abs(p.lng)<=180;
 async function geo(name,address){if(c.geocoding===false)return null;let key=(name||'').toLowerCase()+'|'+(address||'').toLowerCase();if(points.has(key))return points.get(key);for(let provider of ['goong','vietmap']){let api=provider==='goong'?c.goongApiKey:c.vietmapServicesKey;if(!api||now()<(blocked.get(provider)||0))continue;const request=async path=>{let wait=250-(now()-(last.get(provider)??-Infinity));if(wait>0)await new Promise(r=>setTimeout(r,wait));last.set(provider,now());let url=provider==='goong'?`https://rsapi.goong.io/${path}&api_key=${api}`:`https://maps.vietmap.vn/api/${path}&apikey=${api}`;let r=await p.fetchTimeout(url,{headers:{Accept:'application/json'},redirect:'error'},6000);let j=await r.json();if(!r.ok||j.error||/DENIED|LIMIT|QUOTA|INVALID_KEY/i.test(j.status||''))throw new Error('provider failed');return j;};
 const search=async(text,second)=>{let path=provider==='goong'?(second?'Geocode?address=':'Place/AutoComplete?limit=10&more_compound=true&input=')+encodeURIComponent(text):(second?'search':'autocomplete')+'/v4?display_type=6&text='+encodeURIComponent(text);let j=await request(path);return (provider==='goong'?(j.predictions||j.results||[]):Array.isArray(j)?j:j.data||[]).map(r=>provider==='goong'?{id:r.place_id,name:r.structured_formatting?.main_text||r.name||'',text:[r.structured_formatting?.main_text||r.name||'',r.structured_formatting?.secondary_text,r.description,r.formatted_address].filter(Boolean).join(' '),district:r.compound?.district&&r.compound?.province?plain(r.compound.district)+'|'+plain(r.compound.province):null,point:r.geometry?.location||null}:{id:r.ref_id,name:r.name||'',text:[r.name,r.address,r.display].filter(Boolean).join(' '),district:r.boundaries?.find(b=>b.type===1)?.id||null,point:null});};
 const find=async(text,fits)=>{if(!text)return [];for(let second of [false,true]){let rows=(await search(text,second)).filter(fits);if(rows.length)return rows;}return [];};
 try{let nw=words(name).filter(w=>!['quan','nha','hang','tiem','cua','restaurant','the','and'].includes(w));let named=nw.length?await find(name,r=>nw.every(w=>words(r.name).includes(w))):[];let addr=null;if(address){let text=withoutFloor(address),target=plain(text.split(',')[0]).replace(/^so (?=\d)/,'').replace(/ (?:quan|phuong|q|p|tp|thanh pho|tx|thi xa)(?: .*)?$/,'');if(!/^\d+[a-z]?(?:[/ ]\d+[a-z]?)* [a-z]/.test(target))target=null;let aw=words(text).filter(w=>!['p','phuong','tp'].includes(w)).map(w=>w==='q'?'quan':w);addr=(await find(text,r=>target?plain(r.text).includes(target):aw.length&&aw.every(w=>words(r.text).includes(w))))[0]||null;}let chosen=addr?.district?named.find(r=>r.district===addr.district):null,source='name';if(!chosen&&addr){chosen=addr;source='address';}if(!chosen&&named.length){chosen=named[0];source=new Set(named.map(r=>r.district).filter(Boolean)).size>1?'branch':'name';}if(!chosen)return null;let point=chosen.point;if(!valid(point)&&chosen.id){let j=await request(provider==='goong'?'Place/Detail?place_id='+encodeURIComponent(chosen.id):'place/v4?refid='+encodeURIComponent(chosen.id));point=provider==='goong'?j.result?.geometry?.location:j;}if(valid(point)){let out={lat:point.lat,lng:point.lng,source,provider};points.set(key,out);return out;}}catch{blocked.set(provider,now()+600000);}}
 return null;}
 async function shopee(name,address){
  if(!name||!address||c.webSearchProvider!=='brave'||!c.webSearchKey)return null;
  const n=clean(name.replace(/"/g,' ')).slice(0,200);
  const locality=s=>plain(s).replace(/\b(?:tp hcm|tphcm|hcmc|hcm|tp ho chi minh|thanh pho ho chi minh)\b/g,'ho chi minh').replace(/\bq\s*(\d+)\b/g,'quan $1').replace(/\bp\s*(\d+)\b/g,'phuong $1');
  const parts=withoutFloor(address).split(',').map(locality).filter(Boolean);
  // Some extracted addresses put a comma between the house number and street.
  if(/^\d+[a-z]?(?:[ /]\d+[a-z]?)*$/.test(parts[0])&&parts.length>1)parts.splice(0,2,parts[0]+' '+parts[1]);
  const street=(parts[0]||'').replace(/^so (?=\d)/,'').replace(/^\d+[a-z]?(?:[ /]\d+[a-z]?)*\s+/,'').replace(/^duong /,'').replace(/ (?:quan|phuong|q\s*\d+|p\s*\d+|tp|thanh pho)(?: .*)?$/,'');
  const city=parts.map(s=>s.match(/\b(ho chi minh|ha noi|da nang|hai phong|can tho)\b/)?.[1]||s.match(/^(?:tp|thanh pho) (.+)$/)?.[1]).find(Boolean)||null;
  const contexts=[...new Set([street,city].filter(Boolean))];
  if(!contexts.length)return null;
  const key=plain(n)+'|'+locality(address);
  if(stores.has(key))return stores.get(key);
  const nw=words(n),queries=contexts.map(context=>`site:shopeefood.vn "${n}" ${context}`);
  for(const q of new Set(queries)){
   try{for(const row of await p.brave(q)){
    const url=String(row.url||'').split(/[?#&]/)[0];
    const m=url.match(/^https:\/\/shopeefood\.vn\/([a-z0-9]+(?:-[a-z0-9]+)*)\/([a-z0-9]+(?:-[a-z0-9]+)*)\/?$/);
    if(!m||m[1]==='thuong-hieu'||['food','drinks','danh-sach-dia-diem-giao-tan-noi','collections','top-food','deals'].includes(m[2]))continue;
    const text=clean([row.title,row.snippet].filter(Boolean).join(' ').replace(/<[^>]*>/g,' '));
    if(/\bnot found\b|\b404\b/i.test(text))continue;
    if(!nw.length||!nw.every(w=>words(text).includes(w)))continue;
    // The listing title, snippet or URL can identify the street or city.
    const evidence=' '+locality(text+' '+m[1]+' '+m[2])+' ';
    if(!contexts.some(context=>evidence.includes(' '+context+' ')))continue;
    stores.set(key,url);return url;
   }}catch{}
  }
  return null;
 }

 return async d=>{let name=d.venue.restaurant_name.status==='found'?d.display.name:null,address=d.address;let [g,s]=await Promise.all([geo(clean(name).slice(0,300),clean(address).slice(0,300)),shopee(name,address)]);if(g){d.latitude=g.lat;d.longitude=g.lng;d.geoSource=g.provider+'_'+g.source;}d.shopeeFoodUrl=s;};
}
module.exports={createLookup};
