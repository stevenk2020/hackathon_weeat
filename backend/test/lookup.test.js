'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createLookup}=require('../lib/lookup');
const store='https://shopeefood.vn/ho-chi-minh/pizza-4p-s-hai-ba-trung';
const address='151A-151B, Hai Bà Trưng, Xuân Hòa, Hồ Chí Minh';
async function lookup(rows,addr=address,name="Pizza 4P's",queries=[],fetchTimeout){const d={venue:{restaurant_name:{status:'found'}},display:{name},address:addr,shopeeFoodSearchUrl:'https://www.google.com/search?q=pizza'};await createLookup({geocoding:false,webSearchProvider:'brave',webSearchKey:'test'},{brave:async q=>{queries.push(q);return rows;},fetchTimeout},Date.now)(d);return d;}
test('ShopeeFood finds the Pizza 4Ps video listing with a menu-only snippet',async()=>{
 const queries=[];
 const d=await lookup([{url:store,title:"Pizza 4P's - Hai Bà Trưng",snippet:'Pizza phô mai nhà làm'}],address,"Pizza 4P's",queries);
 assert.equal(d.shopeeFoodUrl,store);
 assert.equal(queries[0],`site:shopeefood.vn Pizza 4P's hai ba trung`);
});
test('ShopeeFood ignores house numbers and outdated ward names',async()=>{
 const d=await lookup([{url:store,title:"Pizza 4P's - Hai Bà Trưng",snippet:'151 Hai Bà Trưng, Võ Thị Sáu'}]);
 assert.equal(d.shopeeFoodUrl,store);
});
test('ShopeeFood falls back to a city query when the street query misses',async()=>{
 const queries=[],d={venue:{restaurant_name:{status:'found'}},display:{name:"Pizza 4P's"},address};
 await createLookup({geocoding:false,webSearchProvider:'brave',webSearchKey:'test'},{brave:async q=>{queries.push(q);return queries.length===1?[]:[{url:store,title:"Pizza 4P's",snippet:'Đặt món'}];}},Date.now)(d);
 assert.equal(d.shopeeFoodUrl,store);assert.equal(queries[1],`site:shopeefood.vn Pizza 4P's ho chi minh`);
});
test('ShopeeFood accepts a street match without city or numbered-address evidence',async()=>{
 assert.equal((await lookup([{url:store,title:"Pizza 4P's - Hai Bà Trưng",snippet:''}],'151A-151B Hai Bà Trưng')).shopeeFoodUrl,store);
});
test('ShopeeFood rejects wrong names, unrelated locations and non-store pages',async()=>{
 for(const row of [
  {url:store,title:'Another restaurant',snippet:'Hai Bà Trưng'},
  {url:'https://shopeefood.vn/ha-noi/pizza-4p-s',title:"Pizza 4P's",snippet:'Hà Nội'},
  {url:'https://shopeefood.vn/thuong-hieu/pizza-4p-s-toan-quoc',title:"Pizza 4P's",snippet:'Hồ Chí Minh'}
 ])assert.equal((await lookup([row])).shopeeFoodUrl,null);
});
test('ShopeeFood retains search fallback when address or search results are missing',async()=>{
 for(const addr of [address,null]){const d=await lookup([],addr);assert.equal(d.shopeeFoodUrl,null);assert.ok(d.shopeeFoodSearchUrl);}
});
test('ShopeeFood keeps different city contexts separate in cache',async()=>{
 let count=0;const run=createLookup({geocoding:false,webSearchProvider:'brave',webSearchKey:'test'},{brave:async()=>{count++;return [{url:store,title:"Pizza 4P's",snippet:'Đặt món'}];}},Date.now);
 for(const city of ['TP.HCM','Hà Nội']){const d={venue:{restaurant_name:{status:'found'}},display:{name:"Pizza 4P's"},address:city};await run(d);assert.equal(d.shopeeFoodUrl,city==='TP.HCM'?store:null);}
 assert.ok(count>=2);
});

test('ShopeeFood accepts Chi Cu when Brave has a Not found description',async()=>{
 const url='https://shopeefood.vn/ho-chi-minh/chi-cu-tran-dinh-xu';
 assert.equal((await lookup([{url,title:'Quán Chay Chị Củ - Trần Đình Xu',snippet:'Not found'}],'4/7 Trần Đình Xu, Quận 1','Quán Chay Chị Củ')).shopeeFoodUrl,url);
 assert.equal((await lookup([{url,title:'Another restaurant',snippet:'Not found'}],'4/7 Trần Đình Xu, Quận 1','Quán Chay Chị Củ')).shopeeFoodUrl,null);
});

test('ShopeeFood searches unquoted names and matches Hotdog to Hot Dog',async()=>{
 const queries=[],url='https://shopeefood.vn/ho-chi-minh/cu-sua-hot-dog';
 const d=await lookup([{url,title:'Cu Sữa - Hot Dog',snippet:'59 Nguyễn Du, Quận 1'}],'59 Nguyễn Du, quận 1','Hotdog Cu Sữa',queries);
 assert.equal(queries[0],'site:shopeefood.vn Hotdog Cu Sữa nguyen du');
 assert.equal(d.shopeeFoodUrl,url);
});

const hotdogUrl='https://shopeefood.vn/ho-chi-minh/cu-sua-hot-dog';
const listingHtml=require('node:fs').readFileSync(require('node:path').join(__dirname,'fixtures/shopeefood/cu-sua-hot-dog.html'),'utf8');
const hotdogRows=[{url:hotdogUrl+'?source_url=foody_ordernow_mobile',title:'Cu Sữa - Hot Dog',snippet:'Xem menu & đặt món trực tuyến'},{url:hotdogUrl,title:'Food Delivery - Cu Sữa - Hot Dog',snippet:'Not found'}];
const htmlResponse=html=>new Response(html,{headers:{'Content-Type':'text/html'}});

test('ShopeeFood verifies a missing street in structured listing data and caches the match',async()=>{
 let searches=0,fetches=0;
 const run=createLookup({geocoding:false,webSearchProvider:'brave',webSearchKey:'test'},{brave:async()=>{searches++;return hotdogRows;},fetchTimeout:async(url,init,ms)=>{
  fetches++;assert.equal(url,hotdogUrl);assert.equal(init.redirect,'error');assert.equal(init.headers.Accept,'text/html');assert.equal(ms,6000);return htmlResponse(listingHtml);
 }},Date.now);
 for(let i=0;i<2;i++){const d={venue:{restaurant_name:{status:'found'}},display:{name:'HOT DOG CỤ SỮA'},address:'59 Nguyễn Du Quận 1'};await run(d);assert.equal(d.shopeeFoodUrl,hotdogUrl);}
 assert.equal(searches,1);assert.equal(fetches,1);
});

test('ShopeeFood rejects unrelated listing names and addresses, including navigation and footer matches',async()=>{
 for(const html of [
  listingHtml.replace('59 Nguyễn Du','12 Lê Lợi')+'<footer>59 Nguyễn Du</footer>',
  listingHtml.replace(/Cu Sữa - Hot Dog/g,'Another restaurant'),
  '<nav>Cu Sữa - Hot Dog, 59 Nguyễn Du</nav><script type="application/ld+json">{"@type":"Organization","name":"Cu Sữa - Hot Dog","address":"59 Nguyễn Du"}</script>',
  '<script type="application/ld+json">invalid JSON</script>',
  '<div id="app"></div>'
 ]){
  let fetches=0;
  const d=await lookup(hotdogRows,'59 Nguyễn Du Quận 1','HOT DOG CỤ SỮA',[],async()=>{fetches++;return htmlResponse(html);});
  assert.equal(d.shopeeFoodUrl,null);assert.ok(d.shopeeFoodSearchUrl);assert.equal(fetches,1);
 }
});

test('ShopeeFood reads JSON-LD graphs and skips malformed scripts',async()=>{
 const html='<script type="application/ld+json">bad</script><script type="application/ld+json">'+JSON.stringify({'@graph':[{'@type':['Restaurant','LocalBusiness'],name:'Cu Sữa - Hot Dog',address:'59 Nguyễn Du, Quận 1'}]})+'</script>';
 const d=await lookup(hotdogRows,'59 Nguyễn Du Quận 1','Hotdog Cu Sữa',[],async()=>htmlResponse(html));
 assert.equal(d.shopeeFoodUrl,hotdogUrl);
});

test('ShopeeFood retains its search fallback when listing fetches fail or exceed limits',async()=>{
 for(const fetchTimeout of [
  async()=>{throw new Error('timeout');},
  async()=>new Response('Not found',{status:404,headers:{'Content-Type':'text/html'}}),
  async()=>new Response(listingHtml,{headers:{'Content-Type':'application/json'}}),
  async()=>new Response(listingHtml,{headers:{'Content-Type':'text/html','Content-Length':'1048577'}}),
  async()=>htmlResponse(' '.repeat(1048577)+listingHtml)
 ])assert.equal((await lookup(hotdogRows,'59 Nguyễn Du Quận 1','Hotdog Cu Sữa',[],fetchTimeout)).shopeeFoodUrl,null);
});

test('ShopeeFood fetches at most two unique name-matched store candidates',async()=>{
 let fetches=0;
 const rows=[...hotdogRows,...[2,3].map(i=>({...hotdogRows[0],url:hotdogUrl+'-'+i})),{...hotdogRows[0],url:'https://example.com/ho-chi-minh/cu-sua-hot-dog'},{...hotdogRows[0],url:'https://shopeefood.vn/thuong-hieu/cu-sua-hot-dog'}];
 const d=await lookup(rows,'59 Nguyễn Du Quận 1','Hotdog Cu Sữa',[],async()=>{fetches++;return htmlResponse('<div id="app"></div>');});
 assert.equal(d.shopeeFoodUrl,null);assert.equal(fetches,2);
 let forbiddenFetches=0;
 const rejected=await lookup([{...hotdogRows[0],title:'Another restaurant'},...rows.slice(-2)],'59 Nguyễn Du Quận 1','Hotdog Cu Sữa',[],async()=>{forbiddenFetches++;return htmlResponse(listingHtml);});
 assert.equal(rejected.shopeeFoodUrl,null);assert.equal(forbiddenFetches,0);
});
