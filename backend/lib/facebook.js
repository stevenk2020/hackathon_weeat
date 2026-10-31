'use strict';
const {spawn}=require('node:child_process');
const crypto=require('node:crypto');
function parseFacebook(value){
 if(typeof value!=='string'||value.length>600)return null;let u;try{u=new URL(/^https?:\/\//i.test(value)?value:'https://'+value);}catch{return null;}
 if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.port||!['facebook.com','www.facebook.com','m.facebook.com','mbasic.facebook.com','fb.watch','www.fb.watch'].includes(u.hostname))return null;
 let p=u.pathname.replace(/\/+$/,''),id,kind='post',url;
 if(u.hostname.endsWith('fb.watch')){if(!/^\/[\w-]+$/.test(p))return null;kind='share';url='https://fb.watch'+p+'/';}
 else if(/^\/share\/(?:r\/|v\/|p\/)?[A-Za-z0-9]+$/.test(p)){kind='share';url='https://www.facebook.com'+p+'/';}
 else {let m;if((m=p.match(/^\/reel\/(\d+)$/))){id=m[1];kind='video';url=`https://www.facebook.com/reel/${id}/`;}
 else if((m=p.match(/^\/(?:[^/]+\/)?videos\/(\d+)$/))||(p==='/watch'&&(id=u.searchParams.get('v')))){id=m?.[1]||id;kind='video';url=`https://www.facebook.com/watch/?v=${id}`;}
 else if((p==='/photo.php'||p==='/photo')&&(id=u.searchParams.get('fbid'))){kind='photo';url=`https://www.facebook.com/photo.php?fbid=${id}`;}
 else if((p==='/permalink.php'||p==='/story.php')&&(id=u.searchParams.get('story_fbid'))){let owner=u.searchParams.get('id');if(!/^\d+$/.test(owner||''))return null;url=`https://www.facebook.com/${owner}/posts/${id}/`;}
 else if((m=p.match(/^\/([A-Za-z0-9.]+)\/posts\/([A-Za-z0-9]+)$/))){id=m[2];url=`https://www.facebook.com/${m[1]}/posts/${id}/`;}
 else if((m=p.match(/^\/[^/]+\/photos\/(?:[^/]+\/)*(\d+)$/))){id=m[1];kind='photo';url=`https://www.facebook.com/photo.php?fbid=${id}`;}
 else return null;
 if(!/^(?:\d+|pfbid[A-Za-z0-9]+)$/.test(id||''))return null;}
 return {platform:'facebook',kind,id:'facebook:'+(id||'share:'+crypto.createHash('sha256').update(url).digest('hex').slice(0,24)),url};
}
const mediaUrl=s=>{try{let u=new URL(s);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&(u.hostname==='fbcdn.net'||u.hostname.endsWith('.fbcdn.net'));}catch{return false;}};
function normalizePost(j,f){
 if(!j||j.error||j.errorDescription)return null;
 const photos=[];for(let m of j.media||[]){if(m.__typename==='Photo'||m.type==='photo'){let u=m.image?.uri||m.photo_image?.uri||m.url||m.thumbnail;if(mediaUrl(u))photos.push(u);}}
 const playback=j.playback_video,legacy=playback?.videoDeliveryLegacyFields;
 const nestedVideo=j.short_form_video_context?.video;
 const stream=[legacy?.browser_native_hd_url,legacy?.browser_native_sd_url,j.video?.playable_url,j.videoUrl,...(j.media||[]).filter(m=>m.__typename==='Video').map(m=>m.playable_url||m.videoDeliveryLegacyFields?.browser_native_sd_url)].find(mediaUrl)||null;
 const reel=/\/(?:reel|share\/r)\//.test(f.url),videoId=j.video?.id||nestedVideo?.id;
 const source=parseFacebook(j.shareable_url||j.url||j.topLevelReelUrl||'')||(reel&&/^\d+$/.test(videoId||'')?parseFacebook('https://www.facebook.com/reel/'+videoId+'/'):f);
 const rawId=j.video?.id||nestedVideo?.id||j.postId||j.post_id;
 return {id:rawId?'facebook:'+rawId:source.id,url:source.url,caption:typeof j.text==='string'?j.text:typeof j.message?.text==='string'?j.message.text:null,photos:photos.length?photos:null,video:playback||j.video||nestedVideo||reel||stream||(j.media||[]).some(m=>m.__typename==='Video')?{url:stream,width:playback?.width??null,height:playback?.height??null,durationSec:playback?.length_in_second??(typeof (j.video?.playable_duration_in_ms??nestedVideo?.playable_duration_in_ms)==='number'?(j.video?.playable_duration_in_ms??nestedVideo.playable_duration_in_ms)/1000:null)}:null,author:j.user?.name||j.pageName||j.video_owner?.name||null,links:typeof j.link==='string'?[j.link]:null,timestamp:j.time||j.timestamp||(typeof j.creation_time==='number'?new Date(j.creation_time*1000).toISOString():null),comments:null};
}
function normalizeComments(rows){let items=[],missing=false;const visit=(c,parent=null)=>{if(typeof c?.text!=='string'){missing=true;return;}items.push({id:c.id||c.commentId||null,parentId:c.replyToCommentId||parent,text:c.text,likes:c.likesCount==null&&c.likes==null?null:Number.isFinite(Number(c.likesCount??c.likes))&&Number(c.likesCount??c.likes)>=0?Math.floor(Number(c.likesCount??c.likes)):null});for(let r of Array.isArray(c.comments)?c.comments:Array.isArray(c.replies)?c.replies:[])visit(r,c.id||c.commentId);};for(let c of rows)visit(c);return {items:items.slice(0,20),status:!items.length?'unavailable':missing||items.length>=20?'partial':'ok',reason:!items.length?'no_comment_text':missing?'missing_fields':items.length>=20?'limit':null};}
function createFacebookReader(c,{fetchImpl=global.fetch,spawnImpl=spawn}={}){
 let children=new Set(),controllers=new Set(),closed=false;
 async function actor(name,input){if(!c.apifyToken)throw Error('apify_not_configured');const ac=new AbortController();controllers.add(ac);try{if(closed)throw Error();let r=await fetchImpl(`https://api.apify.com/v2/acts/apify~facebook-${name}-scraper/run-sync-get-dataset-items?timeout=120&memory=1024`,{method:'POST',headers:{Authorization:'Bearer '+c.apifyToken,'Content-Type':'application/json'},body:JSON.stringify(input),signal:AbortSignal.any([ac.signal,AbortSignal.timeout(c.facebookTimeoutMs||130000)])});if(!r.ok)throw Error('apify_failed');const j=JSON.parse((await limited(r,8*1048576)).toString());if(!Array.isArray(j))throw Error('apify_failed');return j;}catch(e){throw Error(e.message==='apify_not_configured'?e.message:'apify_failed');}finally{controllers.delete(ac);}}
 async function limited(r,max){if(Number(r.headers.get('content-length'))>max)throw Error('too_large');let chunks=[],n=0;for await(let b of r.body){n+=b.length;if(n>max)throw Error('too_large');chunks.push(Buffer.from(b));}return Buffer.concat(chunks);}
 async function download(url,max){if(!mediaUrl(url))throw Error('unsafe_media_url');let ac=new AbortController();controllers.add(ac);try{if(closed)throw Error();let r=await fetchImpl(url,{redirect:'error',signal:AbortSignal.any([ac.signal,AbortSignal.timeout(30000)])});if(!r.ok)throw Error('download_failed');return await limited(r,max);}finally{controllers.delete(ac);}}
 function run(bin,args,max){return new Promise((resolve,reject)=>{if(closed)return resolve(null);let ch,parts=[],n=0,done=false;const end=b=>{if(done)return;done=true;clearTimeout(timer);children.delete(ch);resolve(b);};let timer=setTimeout(()=>{ch?.kill('SIGKILL');end(null);},c.facebookMediaTimeoutMs||60000);try{ch=spawnImpl(bin,args,{shell:false});children.add(ch);ch.stdout.on('data',b=>{n+=b.length;if(n>max){if(!done){done=true;clearTimeout(timer);children.delete(ch);reject(Error('too_large'));ch.kill('SIGKILL');}}else parts.push(Buffer.from(b));});ch.stderr.on('data',()=>{});ch.on('error',()=>end(null));ch.on('close',code=>end(code===0?Buffer.concat(parts):null));}catch{end(null);}});}
 const max=Math.min(c.maxUploadMb||100,100)*1048576;
 return {actor,async fetch(f){const reel=/\/(?:reel|share\/r)\//.test(f.url),input={startUrls:[{url:f.url}],resultsLimit:1};let post;
 if(!reel){const rows=await actor('posts',input);post=normalizePost(rows[0],f);if(!post)throw Error('facebook_unavailable');return post;}
 try{post=normalizePost((await actor('reels',input))[0],f);}catch{}
 if(!post||(!post.caption&&!post.video?.url))try{post=normalizePost((await actor('posts',input))[0],f)||post;}catch{}
 // Keep Reel downloads and comments reachable even when metadata actors fail.
 return post||normalizePost({},f);},async comments(url){try{return normalizeComments(await actor('comments',{startUrls:[{url}],resultsLimit:20,includeNestedComments:true}));}catch{return {items:[],status:'unavailable',reason:'apify_failed'};}},async video(post){if(post.video?.url)try{let b=await download(post.video.url,max);if(require('./upstream').videoInfo(b))return b;}catch(e){if(e.message==='too_large')throw e;}
 let meta=await run(c.facebookYtdlpPath||'yt-dlp',['--no-playlist','--no-cache-dir','--socket-timeout','15','--skip-download','-J','--',post.url],2097152);if(meta)try{let j=JSON.parse(meta);if(j.duration>c.maxVideoSeconds)throw Error('video_too_long');if(j.filesize>max||j.filesize_approx>max)throw Error('too_large');}catch(e){if(['video_too_long','too_large'].includes(e.message))throw e;}
 const bytes=await run(c.facebookYtdlpPath||'yt-dlp',['--no-playlist','--no-cache-dir','--socket-timeout','15','--retries','1','--match-filter',`duration <= ${c.maxVideoSeconds||300}`,'-f','b[ext=mp4]','--max-filesize',String(max),'-o','-','--',post.url],max);return bytes&&require('./upstream').videoInfo(bytes)?bytes:null;},async photos(post){
 async function fetchPhotos(urls){let photos=[],left=max;for(let u of urls.slice(0,10)){let b=await download(u,left);if(!require('./upstream').photoMime(b))throw Error('not_a_photo');left-=b.length;photos.push(b);}return {photos,truncated:urls.length>10};}
 if(post.photos?.length)try{return await fetchPhotos(post.photos);}catch(e){if(e.message==='too_large')throw e;}
 let raw=await run(c.facebookGallerydlPath||'gallery-dl',['--config-ignore','--no-input','-j','--',post.url],4194304),urls;
 try{urls=JSON.parse(raw).filter(x=>x[0]===3&&mediaUrl(x[1])).map(x=>x[1]);}catch{}
 if(!urls?.length)return {photos:[],truncated:false};return fetchPhotos(urls);
 },async close(){closed=true;for(let ch of children)ch.kill('SIGKILL');for(let ac of controllers)ac.abort();}};
}
module.exports={parseFacebook,mediaUrl,normalizePost,normalizeComments,createFacebookReader};
