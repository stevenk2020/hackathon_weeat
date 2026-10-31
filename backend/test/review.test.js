'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {EventEmitter}=require('node:events');
const {PassThrough}=require('node:stream');
const {configFromEnv,createApp,createTikTokReaders}=require('../server');
const {photoMime}=require('../lib/upstream');
const URL='https://www.tiktok.com/@test/video/123456789';
const PHOTO_URL='https://www.tiktok.com/@test/photo/123456789';
const JPEG=Buffer.from([255,216,255,224,0,0,0,0]);
const videoFixture=JSON.parse(fs.readFileSync(path.join(__dirname,'../spec/readers/ytdlp-details-video.json'),'utf8'));
const photoFixture=JSON.parse(fs.readFileSync(path.join(__dirname,'../spec/readers/gallerydl-photo-post.json'),'utf8'));
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const common=['--no-warnings','--no-playlist','--no-cache-dir','--impersonate','chrome'];
const config=env=>configFromEnv({TIKTOK_YTDLP:'1',TIKTOK_GALLERYDL:'1',...env});
function harness(actions,env={},fetchImpl=async()=>new Response(JPEG)) {
  const calls=[],kills=[];
  function spawn(bin,args,opts) {
    const index=calls.length;
    calls.push({bin,args,opts});
    const action=actions[Math.min(index,actions.length-1)];
    if(action==='throw')throw Error('spawn failed');
    const child=new EventEmitter();
    child.stdout=new PassThrough();child.stderr=new PassThrough();
    child.kill=signal=>{kills.push(signal);child.emit('close',9);};
    queueMicrotask(()=>{
      if(typeof action==='function')return action(child);
      if(action==='hang')return;
      if(action==='missing'||action==='error')return child.emit('error',Object.assign(Error('failed'),{code:action==='missing'?'ENOENT':'EIO'}));
      if(action==='stdout-error'||action==='stderr-error')return child[action==='stdout-error'?'stdout':'stderr'].emit('error',Error('broken pipe'));
      if(action==='exit')return child.emit('close',1);
      if(action==='empty')return child.emit('close',0);
      child.stdout.write(Buffer.isBuffer(action)?action:JSON.stringify(action));
      child.emit('close',0);
    });
    return child;
  }
  return {readers:createTikTokReaders(config(env),{spawn,fetchImpl}),calls,kills};
}
function clock(t){t.mock.timers.enable({apis:['setTimeout']});}
async function galleryRetries(t,pending) {
  await flush();t.mock.timers.tick(2000);await flush();t.mock.timers.tick(4000);await flush();return pending;
}
const gallery=(addresses=['https://p16.tiktokcdn.com/a.jpg'],post={desc:'caption',author:{uniqueId:'test',nickname:' Test '}})=>
  [[2,post],...addresses.map(address=>[3,address,post])];

test('reader real fixtures: exact flags, every sanitized field, image order and firstPhoto',async t=>{
  const deadlines=[],timeout=AbortSignal.timeout;
  t.mock.method(AbortSignal,'timeout',ms=>{deadlines.push(ms);return timeout(ms);});
  let downloaded=[];
  const h=harness([videoFixture,photoFixture,photoFixture],{},async(address,init)=>{
    downloaded.push(address);assert.equal(init.redirect,'error');assert.ok(init.signal instanceof AbortSignal);
    return new Response(JPEG);
  });
  const details=await h.readers.tiktokVideo.details(URL);
  const thumb=videoFixture.thumbnails.find(item=>item.id==='originCover').url;
  assert.deepEqual(details,{ok:true,details:{caption:videoFixture.description.slice(0,3000),handle:videoFixture.uploader,
    author:videoFixture.channel.trim().slice(0,200),coverUrl:thumb}});
  assert.deepEqual(h.calls[0],{bin:'yt-dlp',args:[...common,'-J','--skip-download','--',URL],opts:{shell:false}});
  const photos=await h.readers.tiktokPhotos.fetch(PHOTO_URL);
  const post=photoFixture.find(item=>item[0]===2)?.[1]||photoFixture.find(item=>item[0]===3)[2];
  assert.deepEqual(photos.details,{caption:post.desc.slice(0,3000),handle:post.author.uniqueId,author:post.author.nickname.trim().slice(0,200),coverUrl:null});
  const addresses=photoFixture.filter(item=>item[0]===3&&/\.(jpg|jpeg|png|webp|heic)$/i.test(new global.URL(item[1]).pathname)).map(item=>item[1]);
  assert.deepEqual(downloaded,addresses);assert.equal(photos.photos.length,5);assert.equal(photos.truncated,false);
  assert.deepEqual(h.calls[1],{bin:'gallery-dl',args:['--config-ignore','--no-input','-q','-o','browser=firefox','-j','--',PHOTO_URL],opts:{shell:false}});
  downloaded=[];
  const first=await h.readers.tiktokPhotos.firstPhoto(PHOTO_URL);
  assert.deepEqual(downloaded,addresses.slice(0,1));assert.equal(first.photos.length,1);assert.equal(first.truncated,true);
  assert.equal(deadlines.length,6);assert.ok(deadlines.every(ms=>ms===20000));
});
test('yt-dlp video exact selector/max-size arguments and raw stdout',async()=>{
  const bytes=Buffer.from([0,1,2,255]),h=harness([bytes]);
  assert.deepEqual(await h.readers.tiktokVideo.fetch(URL),{ok:true,videoBuffer:bytes,comments:[]});
  const max=70*1048576;
  assert.deepEqual(h.calls[0].args,[...common,'-f',`b[filesize<=${max}]/b[filesize_approx<=${max}]`,'--max-filesize',String(max),'-o','-','--',URL]);
});
for(const mode of ['video','details','gallery'])for(const error of ['throw','missing','error','exit','empty'])
  test(`${mode} process ${error} has the specified code and attempt count`,async t=>{
    clock(t);const h=harness([error]);const reader=mode==='gallery'?h.readers.tiktokPhotos:h.readers.tiktokVideo;
    const pending=mode==='details'?reader.details(URL):reader.fetch(URL);
    const prefix=mode==='gallery'?'gallerydl':'ytdlp',missing=['throw','missing'].includes(error);
    let result;
    if(mode==='gallery'&&!missing)result=await galleryRetries(t,pending);
    else if(mode==='video'&&!missing){await flush();t.mock.timers.tick(1500);await flush();result=await pending;}
    else result=await pending;
    assert.deepEqual(result,{ok:false,error:prefix+(missing?'_missing':'_failed')});
    assert.equal(h.calls.length,missing||mode==='details'?1:mode==='video'?2:3);
  });
test('video retry waits exactly 1500ms; last result wins',async t=>{
  clock(t);const h=harness(['exit',Buffer.from('video')]);const pending=h.readers.tiktokVideo.fetch(URL);
  await flush();t.mock.timers.tick(1499);await flush();assert.equal(h.calls.length,1);
  t.mock.timers.tick(1);await flush();assert.equal((await pending).ok,true);assert.equal(h.calls.length,2);
});
test('gallery retry waits exactly 2000ms then 4000ms; last result wins',async t=>{
  clock(t);const h=harness(['exit','exit',gallery()]);const pending=h.readers.tiktokPhotos.fetch(PHOTO_URL);
  await flush();t.mock.timers.tick(1999);await flush();assert.equal(h.calls.length,1);
  t.mock.timers.tick(1);await flush();assert.equal(h.calls.length,2);
  t.mock.timers.tick(3999);await flush();assert.equal(h.calls.length,2);
  t.mock.timers.tick(1);await flush();assert.equal((await pending).ok,true);assert.equal(h.calls.length,3);
});
for(const mode of ['video','details','gallery'])test(`${mode} configured timeout kills each attempt; timeout wins over close`,async t=>{
  clock(t);const h=harness(['hang'],{TIKTOK_YTDLP_TIMEOUT_MS:'10',TIKTOK_GALLERYDL_TIMEOUT_MS:'10'});
  const pending=mode==='details'?h.readers.tiktokVideo.details(URL):mode==='video'?h.readers.tiktokVideo.fetch(URL):h.readers.tiktokPhotos.fetch(PHOTO_URL);
  t.mock.timers.tick(10);await flush();
  if(mode!=='details'){t.mock.timers.tick(mode==='video'?1500:2000);await flush();t.mock.timers.tick(10);await flush();}
  if(mode==='gallery'){t.mock.timers.tick(4000);await flush();t.mock.timers.tick(10);await flush();}
  assert.deepEqual(await pending,{ok:false,error:'timeout'});assert.equal(h.kills.length,mode==='details'?1:mode==='video'?2:3);
  assert.ok(h.kills.every(signal=>signal==='SIGKILL'));
});
for(const mode of ['video','details','gallery'])test(`${mode} output limit produces exact error and retry policy`,async t=>{
  clock(t);const max=mode==='video'?16:mode==='details'?2097152:4194304;
  const h=harness([Buffer.alloc(max+1)],mode==='video'?{VIDEO_UPLOAD_MAX_MB:String(16/1048576)}:{});
  const pending=mode==='details'?h.readers.tiktokVideo.details(URL):mode==='video'?h.readers.tiktokVideo.fetch(URL):h.readers.tiktokPhotos.fetch(PHOTO_URL);
  const result=mode==='gallery'?await galleryRetries(t,pending):await pending;
  assert.deepEqual(result,{ok:false,error:mode==='video'?'too_large':mode==='details'?'ytdlp_failed':'gallerydl_failed'});
  assert.equal(h.calls.length,mode==='gallery'?3:1);assert.equal(h.kills.length,h.calls.length);
});
for(const data of [Buffer.from('{broken'),null,{}])test(`gallery invalid JSON/array shape ${JSON.stringify(data)} fails after three tries`,async t=>{
  clock(t);const h=harness([data]);assert.deepEqual(await galleryRetries(t,h.readers.tiktokPhotos.fetch(PHOTO_URL)),{ok:false,error:'gallerydl_failed'});
});
test('details field truncation, invalid types/handle, and all thumbnail fallbacks',async()=>{
  for(const id of ['originCover','cover','dynamicCover','top']){
    const thumbs=['dynamicCover','cover','originCover'].filter(x=>['originCover','cover','dynamicCover'].indexOf(x)>=['originCover','cover','dynamicCover','top'].indexOf(id)).map(x=>({id:x,url:'https://p16.tiktokcdn.com/'+x}));
    const h=harness([{description:'x'.repeat(3100),uploader:'valid._9',channel:' '+'a'.repeat(210)+' ',thumbnail:'top',thumbnails:thumbs}]);
    assert.deepEqual((await h.readers.tiktokVideo.details(URL)).details,{caption:'x'.repeat(3000),handle:'valid._9',author:'a'.repeat(200),coverUrl:id==='top'?'top':'https://p16.tiktokcdn.com/'+id});
  }
  for(const uploader of ['@bad','x'.repeat(65),'',null]){
    const h=harness([{description:9,uploader,channel:' ',thumbnail:'x'.repeat(4097)}]);
    assert.deepEqual((await h.readers.tiktokVideo.details(URL)).details,{caption:null,handle:null,author:null,coverUrl:null});
  }
});
test('details invalid JSON fails without retry',async()=>{
  const h=harness([Buffer.from('{invalid')]);
  assert.deepEqual(await h.readers.tiktokVideo.details(URL),{ok:false,error:'ytdlp_failed'});assert.equal(h.calls.length,1);
});
test('gallery filters unsafe URLs/music, preserves order, caps at ten, uses fallback post metadata',async()=>{
  const post={desc:'caption',author:{uniqueId:'test',nickname:' Test '}},good=Array.from({length:12},(_,i)=>`https://sub.tiktokcdn.com/${i}.JPG?signature=private`);
  const bad=['http://p16.tiktokcdn.com/a.jpg','https://tiktokcdn.com.attacker.test/a.jpg','https://p16.tiktokcdn.com/music.mp3'];
  const messages=[...bad,...good].map(address=>[3,address,post]);let addresses=[];
  const h=harness([messages],{},async address=>{addresses.push(address);return new Response(JPEG);});
  const result=await h.readers.tiktokPhotos.fetch(PHOTO_URL);
  assert.deepEqual(addresses,good.slice(0,10));assert.equal(result.truncated,true);assert.equal(result.photos.length,10);
  assert.deepEqual(result.details,{caption:'caption',handle:'test',author:'Test',coverUrl:null});
  assert.ok(!JSON.stringify(result).includes('signature=private'));
});
for(const reason of ['no_photos','network','status','empty','magic'])test(`gallery ${reason} failure uses exact code and three attempts`,async t=>{
  clock(t);const h=harness([gallery(reason==='no_photos'?['https://attacker.test/a.jpg']:undefined)],{},async()=>{
    if(reason==='network')throw Error('network');
    return reason==='status'?new Response('failure',{status:503}):new Response(reason==='empty'?Buffer.alloc(0):reason==='magic'?Buffer.from('invalid'):JPEG);
  });
  assert.deepEqual(await galleryRetries(t,h.readers.tiktokPhotos.fetch(PHOTO_URL)),{ok:false,error:reason==='no_photos'?'no_photos':reason==='magic'?'not_a_photo':'download_failed'});
  assert.equal(h.calls.length,3);
});
for(const declared of [true,false])test(`gallery aggregate size budget via ${declared?'content-length':'stream'} stops without retry`,async()=>{
  const h=harness([gallery(['https://p16.tiktokcdn.com/a.jpg','https://p16.tiktokcdn.com/b.jpg'])],{VIDEO_UPLOAD_MAX_MB:String(12/1048576)},async()=>new Response(JPEG,declared?{headers:{'Content-Length':String(JPEG.length)}}:{}));
  assert.deepEqual(await h.readers.tiktokPhotos.fetch(PHOTO_URL),{ok:false,error:'too_large'});assert.equal(h.calls.length,1);
});
test('photo magic accepts supported formats and rejects HEIF markers in minor version or unaligned bytes',()=>{
  assert.equal(photoMime(JPEG),'image/jpeg');
  assert.equal(photoMime(Buffer.from([137,80,78,71,13,10,26,10])),'image/png');
  assert.equal(photoMime(Buffer.from('RIFF1234WEBP')),'image/webp');
  for(const offset of [8,16]){let b=Buffer.alloc(32);b.writeUInt32BE(32,0);b.write('ftyp',4);b.write('heic',offset);assert.equal(photoMime(b),'image/heic');}
  for(const offset of [12,9,17]){let b=Buffer.alloc(32);b.writeUInt32BE(32,0);b.write('ftyp',4);b.write('heic',offset);assert.equal(photoMime(b),null);}
});
test('pipe errors settle reader work and kill child instead of crashing',async t=>{
  clock(t);for(const error of ['stdout-error','stderr-error']){const h=harness([error]);assert.deepEqual(await h.readers.tiktokVideo.details(URL),{ok:false,error:'ytdlp_failed'});assert.deepEqual(h.kills,['SIGKILL']);}
});
test('reader close aborts an in-flight photo download and settles without retry',async()=>{
  let began;const started=new Promise(resolve=>{began=resolve;});
  const h=harness([gallery()],{},async(address,init)=>new Promise((resolve,reject)=>{began();init.signal.addEventListener('abort',()=>reject(new DOMException('cancelled','AbortError')),{once:true});}));
  const pending=h.readers.tiktokPhotos.fetch(PHOTO_URL);await started;await h.readers.tiktokPhotos.close();
  assert.deepEqual(await pending,{ok:false,error:'download_failed'});assert.equal(h.calls.length,1);
});

async function withApp(t,options={}) {
  const root=fs.mkdtempSync(path.join(__dirname,'.tmp-review-'));
  const c=configFromEnv({GEMINI_API_KEY:'fake',YOUTUBE_API_KEY:'fake',SAVE_TOKEN_SECRET:'x'.repeat(40),
    LIBRARY_DB_PATH:':memory:',CACHE_DIR:root,TIKTOK_COVER_SAVE:'0'});
  const a=createApp(c,{now:()=>0,verifier:async()=>({ok:true,uid:'test-user'}),tiktokVideo:null,tiktokPhotos:null,...options});
  await new Promise(resolve=>a.server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await a.close();assert.equal(path.dirname(root),__dirname);fs.rmSync(root,{recursive:true,force:true});});
  return {app:a,base:'http://127.0.0.1:'+a.server.address().port};
}
for(const phase of ['text','video'])for(const failure of ['TimeoutError','AbortError','bad-json','null'])
  test(`analyze Gemini ${phase} ${failure} returns the correct status/code`,async t=>{
    const {base}=await withApp(t,{fetchImpl:async(address,init)=>{
      address=String(address);
      if(address.includes('/oembed?'))return new Response(JSON.stringify({title:'Cafe Test',author_url:'https://www.tiktok.com/@test'}));
      if(address.includes('/youtube/v3/videos'))return new Response(JSON.stringify({items:[{snippet:{title:'Cafe Test',channelTitle:'Test'},contentDetails:{duration:'PT30S'}}]}));
      if(address.includes('/commentThreads'))return new Response(JSON.stringify({items:[]}));
      if(address.includes('generateContent')&&phase==='video')return new Response(JSON.stringify({candidates:[{content:{parts:[{text:JSON.stringify({is_about_specific_place:false})}]}}]}));
      if(['TimeoutError','AbortError'].includes(failure))throw new DOMException('AI failed',failure);
      const text=failure==='null'?'null':'not JSON';
      return new Response(JSON.stringify(phase==='video'?{steps:[{type:'model_output',content:[{text}]}]}:{candidates:[{content:{parts:[{text}]}}]}));
    }});
    const response=await fetch(base+'/api/analyze',{method:'POST',headers:{Authorization:'Bearer test','Content-Type':'application/json'},body:JSON.stringify({url:phase==='text'?URL:'https://www.youtube.com/shorts/abcdefghijk'})});
    assert.equal(response.status,['TimeoutError','AbortError'].includes(failure)?504:502);
    assert.equal((await response.json()).error.code,['TimeoutError','AbortError'].includes(failure)?'timeout':'ai_bad_output');
  });
test('HTTP response Date is derived from deps.now',async t=>{
  const {base}=await withApp(t,{fetchImpl:async()=>{throw Error('no network');}});
  const response=await fetch(base+'/api/categories');assert.equal(response.headers.get('date'),new Date(0).toUTCString());await response.text();
});
test('personal pair and document-id mutations cannot access another uid',async t=>{
  const {base}=await withApp(t,{verifier:async token=>({ok:true,uid:token}),fetchImpl:async address=>{
    if(String(address).includes('/oembed?'))return new Response(JSON.stringify({title:'Cafe Test',author_url:'https://www.tiktok.com/@test'}));
    return new Response(JSON.stringify({candidates:[{content:{parts:[{text:JSON.stringify({is_about_specific_place:true,
      restaurant_name:{value:'Cafe Test',source:'description',evidence:'Cafe Test',confidence:'high'}})}]}}]}));
  }});
  const request=(route,method,token,body)=>fetch(base+route,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  const analyzed=await (await request('/api/analyze','POST','alice',{url:URL})).json();
  const r=analyzed.restaurants[0],pair=`/api/library/${r.video_id}/${r.restaurant_id}`;
  for(const [route,method,body] of [[pair+'/save','PUT',{}],[pair,'PATCH',{edits:{user_note:'changed'}}],['/api/library/'+r.doc_id,'PATCH',{note:'changed'}],['/api/library/'+r.doc_id,'DELETE']]){
    const response=await request(route,method,'bob',body);assert.equal(response.status,404);assert.equal((await response.json()).error.code,'not_found');
  }
  assert.equal((await request(pair+'/save','PUT','alice',{})).status,200);
  const library=await (await request('/api/library','GET','alice')).json();assert.equal(library.records.length,1);assert.equal(library.records[0].userNote,null);
});
test('provider spacing uses the injected clock correctly even when it starts at zero',async t=>{
  clock(t);const {createLookup}=require('../lib/lookup');let time=0,times=[];
  const lookup=createLookup(config({GOONG_API_KEY:'fake',WEB_SEARCH_KEY:''}),{fetchTimeout:async()=>{
    times.push(time);return new Response(JSON.stringify({predictions:[],results:[]}));
  }},()=>time);
  const pending=lookup({venue:{restaurant_name:{status:'found'}},display:{name:'Test Cafe'},address:null});
  await flush();assert.deepEqual(times,[0]);time=249;t.mock.timers.tick(249);await flush();assert.deepEqual(times,[0]);
  time=250;t.mock.timers.tick(1);await pending;assert.deepEqual(times,[0,250]);
});
test('a verifier rejecting with null receives a generic JSON answer',async t=>{
  const {base}=await withApp(t,{verifier:async()=>{throw null;},fetchImpl:async()=>{throw Error('no network');}});
  const response=await fetch(base+'/api/library',{headers:{Authorization:'Bearer test'},signal:AbortSignal.timeout(2000)});
  assert.equal(response.status,500);assert.equal((await response.json()).error.code,'internal_error');
});
test('application close cancels readers before waiting for their active HTTP requests',async t=>{
  let resolveReader,started;
  const readerStarted=new Promise(resolve=>{started=resolve;});
  const {app,base}=await withApp(t,{
    tiktokVideo:{fetch:()=>{started();return new Promise(resolve=>{resolveReader=resolve;});},
      details:async()=>({ok:false,error:'ytdlp_failed'}),close:async()=>resolveReader({ok:false,error:'ytdlp_failed'})},
    fetchImpl:async(address,init)=>{
      if(init.signal.aborted)throw new DOMException('closing','AbortError');
      if(String(address).includes('/oembed?'))return new Response(JSON.stringify({title:'Cafe Test',author_url:'https://www.tiktok.com/@test'}));
      throw Error('No live service expected');
    },
  });
  const pending=fetch(base+'/api/analyze',{method:'POST',headers:{Authorization:'Bearer test','Content-Type':'application/json'},body:JSON.stringify({url:URL}),signal:AbortSignal.timeout(2000)});
  await readerStarted;const closing=app.close();const response=await pending;
  assert.equal(response.status,504);assert.equal((await response.json()).error.code,'timeout');await closing;
});
for(const phase of ['text','video'])for(const errorName of ['TimeoutError','AbortError'])
  test(`analyze Gemini ${phase} body-read ${errorName} returns 504 timeout`,async t=>{
    const {base}=await withApp(t,{fetchImpl:async address=>{
      address=String(address);
      if(address.includes('/oembed?'))return new Response(JSON.stringify({title:'Cafe Test',author_url:'https://www.tiktok.com/@test'}));
      if(address.includes('/youtube/v3/videos'))return new Response(JSON.stringify({items:[{snippet:{title:'Cafe Test'},contentDetails:{duration:'PT30S'}}]}));
      if(address.includes('/commentThreads'))return new Response(JSON.stringify({items:[]}));
      if(address.includes('generateContent')&&phase==='video')return new Response(JSON.stringify({candidates:[{content:{parts:[{text:'{}'}]}}]}));
      return {ok:true,json:async()=>{throw new DOMException('body read failed',errorName);}};
    }});
    const response=await fetch(base+'/api/analyze',{method:'POST',headers:{Authorization:'Bearer test','Content-Type':'application/json'},body:JSON.stringify({url:phase==='text'?URL:'https://www.youtube.com/shorts/abcdefghijk'})});
    assert.equal(response.status,504);assert.equal((await response.json()).error.code,'timeout');
  });
