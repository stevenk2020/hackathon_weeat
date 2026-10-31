'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {createApp,configFromEnv}=require('../server');
const {hash}=require('../lib/records');
const videoId='7284405321844460801',videoUrl=`https://www.tiktok.com/@uyen.phuongle/video/${videoId}`;
const store='https://shopeefood.vn/ho-chi-minh/cu-sua-hot-dog',key='x'.repeat(32),email='recovery@example.com',uid='csv-'+hash(email);
const listingHtml=fs.readFileSync(path.join(__dirname,'fixtures/shopeefood/cu-sua-hot-dog.html'),'utf8');
const json=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});

async function setup(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'weeat-shopeefood-'));
 const state={available:false,address:'59 Nguyễn Du Quận 1',url:store,clock:Date.parse('2026-10-31T09:15:00Z'),writes:[]};
 const config=configFromEnv({YOUTUBE_API_KEY:'fake',GEMINI_API_KEY:'fake',SAVE_TOKEN_SECRET:'test-secret-with-at-least-32-characters',EXTRACT_API_KEY:key,WEB_SEARCH_PROVIDER:'brave',WEB_SEARCH_KEY:'fake',GEOCODING:'0',LIBRARY_DB_PATH:path.join(root,'library.db'),CACHE_DIR:path.join(root,'cache')});
 const fetchImpl=async url=>{
  url=String(url);
  if(url.startsWith('https://www.tiktok.com/oembed?'))return json({title:'HOT DOG CỤ SỮA '+state.address,author_name:'Test',author_url:'https://www.tiktok.com/@uyen.phuongle'});
  if(url.includes(':generateContent'))return json({candidates:[{content:{parts:[{text:JSON.stringify({is_about_specific_place:true,restaurant_name:{value:'HOT DOG CỤ SỮA',source:'description',evidence:'HOT DOG CỤ SỮA',confidence:'high'},location:{value:state.address,source:'description',evidence:state.address,confidence:'high'},dish:{value:null,source:null,evidence:null,confidence:null},price:{value:null,source:null,evidence:null,confidence:null},dish_group:'other'})}]}}]});
  if(url.startsWith('https://api.search.brave.com/'))return json({web:{results:state.available?[{url:state.url,title:'Cu Sữa - Hot Dog',description:state.url===store?'Xem menu & đặt món trực tuyến':state.address}]:[]}});
  if(url===store)return new Response(listingHtml,{headers:{'Content-Type':'text/html'}});
  throw new Error('Unexpected request host: '+new URL(url).host);
 };
 let app,base;
 async function start(){
  app=createApp(config,{fetchImpl,now:()=>state.clock,verifier:async()=>({ok:true,uid}),tiktokVideo:null,tiktokPhotos:null,postgres:{writeExtract:async(...args)=>state.writes.push(structuredClone(args)),close:async()=>{}}});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${app.server.address().port}`;
 }
 await start();
 t.after(async()=>{await app.close();fs.rmSync(root,{recursive:true,force:true});});
 async function request(route,method,body){const r=await fetch(base+route,{method,headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(body)});assert.equal(r.status,200);return r.json();}
 function stored(){const db=new DatabaseSync(config.libraryDbPath,{readOnly:true});try{return db.prepare('SELECT * FROM library WHERE uid=? AND video_id=?').get(uid,videoId);}finally{db.close();}}
 return {state,request,stored,extract:refresh=>request('/api/extract','POST',{url:videoUrl,email,refresh}),restart:async()=>{await app.close();await start();}};
}

test('repeat extract persists a recovered store link and preserves saved state, notes and extraction data',async t=>{
 const {state,request,stored,extract,restart}=await setup(t);
 const first=await extract();assert.equal(first.places[0].shopeeFoodUrl,null);assert.equal(first.row.shopeefood_kinds,'search');
 const route=`/api/library/${videoId}/${first.places[0].restaurant_id}`;
 await request(route,'PATCH',{edits:{user_note:'Keep my note'}});
 await request(route+'/save','PUT',{});
 const before=stored(),original=JSON.parse(before.data);
 state.available=true;state.clock+=1000;
 const recovered=await extract(),after=stored();
 assert.equal(recovered.places[0].shopeeFoodUrl,store);assert.equal(recovered.row.shopeefood_kinds,'store');assert.equal(recovered.postgres,'written');
 assert.equal(after.is_saved,1);assert.equal(after.restaurant_id,before.restaurant_id);assert.equal(after.doc_id,before.doc_id);assert.equal(after.create_time,before.create_time);assert.notEqual(after.update_time,before.update_time);
 assert.deepEqual(JSON.parse(after.data),{...original,shopeeFoodUrl:store});
 const copied=state.writes.at(-1);assert.equal(copied[2].shopeefood_kinds,'store');assert.equal(copied[3][0].shopeeFoodUrl,store);assert.equal(copied[4][0].is_saved,1);
 state.available=false;state.clock+=1000;await restart();
 const retained=await extract();assert.equal(retained.places[0].shopeeFoodUrl,store);assert.deepEqual(stored(),after);
});

test('repeat extract does not copy a recovered link from a different restaurant branch',async t=>{
 const {state,stored,extract}=await setup(t);
 await extract();const before=stored();
 state.available=true;state.address='12 Lê Lợi Quận 1';state.url=store+'-le-loi';state.clock+=1000;
 const refreshed=await extract(true);
 assert.equal(refreshed.places[0].shopeeFoodUrl,null);assert.equal(refreshed.places[0].address,'59 Nguyễn Du Quận 1');assert.deepEqual(stored(),before);
});
