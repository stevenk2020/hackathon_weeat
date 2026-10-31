'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {parseFacebook,normalizePost,normalizeComments,createFacebookReader}=require('../lib/facebook');
const {parseLink,createPipeline}=require('../lib/upstream');const {configFromEnv,createApp}=require('../server');
const URL='https://www.facebook.com/reel/599054840662806/',JPEG=Buffer.from([255,216,255,0]);
const json=x=>new Response(JSON.stringify(x));
function config(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'facebook-test-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return configFromEnv({APIFY_TOKEN:'private-apify-token',GEMINI_API_KEY:'test',GEMINI_MODEL:'test',CACHE_DIR:path.join(root,'cache'),LIBRARY_DB_PATH:path.join(root,'data.db'),EXTRACT_API_KEY:'x'.repeat(32),GEOCODING:'0'});}
function mp4(sec=30){let b=Buffer.alloc(48);b.write('ftyp',4);b.write('isom',8);b.write('mvhd',16);b.writeUInt32BE(1000,32);b.writeUInt32BE(sec*1000,36);return b;}
function fakeSpawn(output,calls=[]){return (bin,args,opts)=>{calls.push({bin,args,opts});const {EventEmitter}=require('node:events'),{PassThrough}=require('node:stream');let ch=new EventEmitter();ch.stdout=new PassThrough();ch.stderr=new PassThrough();ch.kill=()=>ch.emit('close',1);queueMicrotask(()=>{ch.stdout.emit('data',args.includes('-J')?Buffer.from('{"duration":30}'):output);ch.emit('close',0);});return ch;};}
const empty={value:null};
const metadata={is_about_specific_place:true,restaurant_name:{value:'Cafe Test',source:'description',evidence:'Cafe Test',confidence:'high'},dish:empty,location:empty,price:empty};
async function ai(url,init){if(String(url).includes('/interactions'))return json({steps:[{type:'model_output',content:[{text:JSON.stringify({venues:[],script:[]})}]}]});const body=JSON.parse(init.body);return json({candidates:[{content:{parts:[{text:JSON.stringify(body.contents[0].parts[0].text.includes('<comments>')?{ratings:[]}:metadata)}]}}]});}
test('Facebook canonical URLs reject foreign hosts and preserve identity query parameters',()=>{
 for(const u of [URL,'http://m.facebook.com/reel/599054840662806/?mibextid=abc'])assert.equal(parseLink(u).url,URL);
 for(const [u,kind,id] of [['facebook.com/watch/?v=123&x=a','video','123'],['facebook.com/a/videos/123/','video','123'],['facebook.com/photo.php?fbid=123&set=a.4','photo','123'],['facebook.com/a/photos/a.55/123/','photo','123'],['facebook.com/story.php?story_fbid=123&id=44','post','123'],['facebook.com/a/posts/pfbidABC/?x=2','post','pfbidABC']]){let p=parseFacebook(u);assert.equal(p.kind,kind);assert.equal(p.id,'facebook:'+id);}
 for(let u of ['facebook.com/share/r/ABC/','facebook.com/share/p/ABC/','fb.watch/Ab_cd/'])assert.equal(parseFacebook(u).kind,'share');
 for(let u of ['https://facebook.com.evil.com/reel/123','https://facebook.com@evil.com/reel/123','https://facebook.com/profile.php?id=123','https://facebook.com:444/reel/123'])assert.equal(parseFacebook(u),null);
});
test('actual actor output schemas normalize photos, streams, captions and string likes; count is never text',()=>{
 const f=parseFacebook(URL),reel=normalizePost(require('./fixtures/facebook/reel.json'),f),post=normalizePost(require('./fixtures/facebook/post.json'),f);
 assert.equal(reel.video.durationSec,49.365);assert.match(reel.video.url,/\.mp4$/);assert.equal(reel.id,'facebook:599054840662806');assert.equal(post.photos.length,5);assert.equal(post.comments,null);
 assert.equal(normalizePost({},f).caption,null);assert.equal(normalizePost({},f).photos,null);assert.equal(normalizePost({error:'blocked'},f),null);
 const c=normalizeComments([{id:'a',text:'food',likesCount:'7',comments:[{text:'reply',likesCount:2}]},{likesCount:9}]);assert.equal(c.items[0].likes,7);assert.equal(c.items[1].parentId,'a');assert.equal(c.status,'partial');assert.equal(normalizeComments([{comments:12}]).status,'unavailable');
});
test('Apify authentication is header-only; bad status, malformed and empty results fail safely',async t=>{
 const c=config(t);let calls=[];const r=createFacebookReader(c,{fetchImpl:async(url,init)=>{calls.push({url,init});return json([require('./fixtures/facebook/reel.json')]);}});await r.fetch(parseFacebook(URL));assert.ok(!calls[0].url.includes(c.apifyToken));assert.equal(calls[0].init.headers.Authorization,'Bearer '+c.apifyToken);
 for(const response of [()=>new Response('secret error',{status:403}),()=>json({bad:true}),()=>json([])]){let reader=createFacebookReader(c,{fetchImpl:async()=>response()});await assert.rejects(reader.fetch(parseFacebook('https://www.facebook.com/test/posts/123/')),/apify_failed|facebook_unavailable/);assert.equal((await reader.comments(URL)).status,'unavailable');}
});
test('stream bytes preferred; invalid stream invokes bounded yt-dlp with separated arguments',async t=>{
 let c=config(t),calls=[];let r=createFacebookReader(c,{fetchImpl:async()=>new Response(mp4()),spawnImpl:fakeSpawn(mp4(),calls)});assert.ok((await r.video({url:URL,video:{url:'https://video.xx.fbcdn.net/test.mp4'}})).length);assert.equal(calls.length,0);
 r=createFacebookReader(c,{fetchImpl:async()=>new Response('invalid'),spawnImpl:fakeSpawn(mp4(),calls)});assert.ok((await r.video({url:URL,video:{url:'https://video.xx.fbcdn.net/test.mp4'}})).length);assert.equal(calls.length,2);assert.ok(calls[1].args.includes('--max-filesize'));assert.ok(calls.every(x=>x.opts.shell===false&&x.args.at(-2)==='--'));
});
test('photos use actor URLs in order, cap at ten, and fall back to gallery-dl after expired media',async t=>{
 let c=config(t),downloads=[],calls=[];let r=createFacebookReader(c,{fetchImpl:async u=>{downloads.push(u);return new Response(JPEG);},spawnImpl:fakeSpawn(Buffer.from('[]'),calls)});
 let p=await r.photos({url:URL,photos:Array.from({length:11},(_,i)=>`https://scontent.xx.fbcdn.net/${i}.jpg`)});assert.equal(p.photos.length,10);assert.equal(p.truncated,true);assert.equal(calls.length,0);assert.match(downloads[1],/1.jpg/);
 r=createFacebookReader(c,{fetchImpl:async u=>u.includes('expired')?new Response('',{status:403}):new Response(JPEG),spawnImpl:fakeSpawn(Buffer.from(JSON.stringify([[3,'https://scontent.xx.fbcdn.net/fallback.jpg',{}]])),calls)});assert.equal((await r.photos({url:URL,photos:['https://scontent.xx.fbcdn.net/expired.jpg']})).photos.length,1);assert.equal(calls.length,1);
});
test('extract uses SQLite mapping, namespaced IDs and retains comments on failed refresh',async t=>{
 let c=config(t),failComments=false;let facebook={fetch:async()=>({id:'facebook:599054840662806',url:URL,caption:'Cafe Test',photos:null,video:null,author:null}),photos:async()=>({photos:[]}),comments:async()=>failComments?{status:'unavailable',reason:'apify_failed',items:[]}:{status:'ok',reason:null,items:[{text:'Good cafe',likes:4}]}};
 let writes=[];let app=createApp(c,{facebook,fetchImpl:ai,postgres:{writeExtract:async(...args)=>writes.push(args),close:async()=>{}}});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>app.close());let request=async()=>{let r=await fetch(`http://127.0.0.1:${app.server.address().port}/api/extract`,{method:'POST',headers:{Authorization:'Bearer '+'x'.repeat(32),'Content-Type':'application/json'},body:JSON.stringify({email:'test@example.com',url:URL,refresh:true})});assert.equal(r.status,200);return r.json();};
 let a=await request();assert.equal(a.row.video_id,'facebook:599054840662806');assert.equal(a.postgres,'written');const pg=require('../lib/postgres').placeRow('u',writes[0][3][0],writes[0][4][0]);assert.equal(pg.platform,'facebook');assert.equal(pg.video_id,'facebook:599054840662806');assert.equal(pg.comments_count,1);assert.equal(a.places[0].source.videoUrl,URL);assert.equal(a.places[0].comments.items[0].text,'Good cafe');failComments=true;let b=await request();assert.equal(b.places[0].comments.status,'partial');assert.equal(b.places[0].comments.items[0].text,'Good cafe');assert.equal(b.places[0].comments.reason,'refresh_failed_preserved');
});
for(let [name,post,bytes,code] of [['metadata duration',{durationSec:301},null,'video_too_long'],['stream duration',{durationSec:1},mp4(301),'video_too_long'],['oversized media',{durationSec:1},null,'video_too_large']])test('Facebook limit '+name,async t=>{
 let c=config(t),reader={fetch:async()=>({id:'facebook:1',url:URL,caption:'Cafe Test',video:post}),comments:async()=>({items:[],status:'unavailable',reason:'error'}),video:async()=>{if(!bytes)throw Error('too_large');return bytes;}};let p=createPipeline(c,{facebook:reader,fetchImpl:ai,now:Date.now});await assert.rejects(p.analyze(URL),e=>e.code===code);
});
test('no provider and missing all caption/media fields produce explicit errors',async t=>{
 let c=config(t);c.apifyToken='';let p=createPipeline(c,{fetchImpl:ai,now:Date.now});await assert.rejects(p.analyze(URL),e=>e.code==='facebook_not_configured');c.apifyToken='fake';p=createPipeline(c,{facebook:{fetch:async()=>({id:'facebook:1',url:URL}),comments:async()=>({items:[],status:'unavailable'}),video:async()=>null},fetchImpl:ai,now:Date.now});await assert.rejects(p.analyze(URL),e=>e.code==='nothing_to_read');
});
test('successful media cache preserves previous comment text after failed refresh',async t=>{
 let c=config(t),failed=false,reader={fetch:async()=>({id:'facebook:599054840662806',url:URL,caption:'Cafe Test',video:{durationSec:30}}),video:async()=>mp4(),comments:async()=>failed?{status:'unavailable',reason:'apify_failed',items:[]}:{status:'ok',items:[{id:'one',text:'Great',likes:1}]}};
 let p=createPipeline(c,{facebook:reader,fetchImpl:ai,now:Date.now});await p.analyze(URL);assert.equal((await p.analyze(URL)).cache.hit,true);failed=true;let r=await p.analyze(URL,true);assert.equal(r.comments.status,'partial');assert.equal(r.comments.reason,'refresh_failed_preserved');assert.equal(r.comments.items[0].text,'Great');
});
test('bounded media rejects advertised oversized photos before consuming bytes',async t=>{
 let c=config(t),reader=createFacebookReader(c,{fetchImpl:async()=>new Response(JPEG,{headers:{'Content-Length':String(100*1048576+1)}})});await assert.rejects(reader.photos({url:URL,photos:['https://scontent.xx.fbcdn.net/a.jpg']}),/too_large/);
});
test('comments actor requests actual text and replies, rejecting numeric count output',async t=>{
 let c=config(t),calls=[],reader=createFacebookReader(c,{fetchImpl:async(url,init)=>{calls.push({url,body:JSON.parse(init.body)});return json([{comments:800}]);}});let r=await reader.comments(URL);assert.equal(r.status,'unavailable');assert.ok(calls[0].url.includes('facebook-comments-scraper'));assert.equal(calls[0].body.includeNestedComments,true);
});
test('Reel share falls back to Posts schema and resolves canonical video identity',async t=>{
 const c=config(t),calls=[],share='https://www.facebook.com/share/r/ABC/';
 const reader=createFacebookReader(c,{fetchImpl:async(url)=>{calls.push(String(url));return json(calls.length===1?[{error:'no_items'}]:[{message:{text:'Cafe Test'},post_id:'123',video:{id:'456'},short_form_video_context:{video:{id:'456',playable_duration_in_ms:57677}},creation_time:1680064223,pageName:'Cafe'}]);}});
 const post=await reader.fetch(parseFacebook(share));assert.equal(post.url,'https://www.facebook.com/reel/456/');assert.equal(post.id,'facebook:456');assert.equal(post.video.durationSec,57.677);assert.equal(post.caption,'Cafe Test');assert.equal(post.timestamp,'2023-03-29T04:30:23.000Z');assert.ok(calls[1].includes('facebook-posts-scraper'));
});
test('failed Reel metadata still permits yt-dlp video analysis and independent comment scraping',async t=>{
 const c=config(t),calls=[],actors=[];
 const reader=createFacebookReader(c,{spawnImpl:fakeSpawn(mp4(),calls),fetchImpl:async(url,init)=>{
  if(String(url).includes('api.apify.com')){actors.push(String(url));return json(String(url).includes('facebook-comments')?[{id:'comment',text:'When do you close?',likesCount:'2'}]:[{error:'no_items'}]);}
  return ai(url,init);
 }});
 const p=createPipeline(c,{facebook:reader,fetchImpl:ai,now:Date.now});const result=await p.analyze('https://www.facebook.com/share/r/ABC/');
 assert.equal(result.analysis_mode,'video_and_text');assert.equal(result.comments.items[0].text,'When do you close?');assert.equal(result.comments.items[0].likes,2);assert.equal(calls.length,2);assert.ok(actors.some(u=>u.includes('facebook-comments-scraper')));
});
test('yt-dlp invalid bytes are not accepted as video',async t=>{
 const reader=createFacebookReader(config(t),{spawnImpl:fakeSpawn(Buffer.from('invalid'))});assert.equal(await reader.video({url:URL}),null);
});
