'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createLookup}=require('../lib/lookup');
const store='https://shopeefood.vn/ho-chi-minh/pizza-4p-s-hai-ba-trung';
const address='151A-151B, Hai Bà Trưng, Xuân Hòa, Hồ Chí Minh';
async function lookup(rows,addr=address,name="Pizza 4P's",queries=[]){const d={venue:{restaurant_name:{status:'found'}},display:{name},address:addr,shopeeFoodSearchUrl:'https://www.google.com/search?q=pizza'};await createLookup({geocoding:false,webSearchProvider:'brave',webSearchKey:'test'},{brave:async q=>{queries.push(q);return rows;}},Date.now)(d);return d;}
test('ShopeeFood finds the Pizza 4Ps video listing with a menu-only snippet',async()=>{
 const queries=[];
 const d=await lookup([{url:store,title:"Pizza 4P's - Hai Bà Trưng",snippet:'Pizza phô mai nhà làm'}],address,"Pizza 4P's",queries);
 assert.equal(d.shopeeFoodUrl,store);
 assert.equal(queries[0],`site:shopeefood.vn "Pizza 4P's" hai ba trung`);
});
test('ShopeeFood ignores house numbers and outdated ward names',async()=>{
 const d=await lookup([{url:store,title:"Pizza 4P's - Hai Bà Trưng",snippet:'151 Hai Bà Trưng, Võ Thị Sáu'}]);
 assert.equal(d.shopeeFoodUrl,store);
});
test('ShopeeFood falls back to a city query when the street query misses',async()=>{
 const queries=[],d={venue:{restaurant_name:{status:'found'}},display:{name:"Pizza 4P's"},address};
 await createLookup({geocoding:false,webSearchProvider:'brave',webSearchKey:'test'},{brave:async q=>{queries.push(q);return queries.length===1?[]:[{url:store,title:"Pizza 4P's",snippet:'Đặt món'}];}},Date.now)(d);
 assert.equal(d.shopeeFoodUrl,store);assert.equal(queries[1],`site:shopeefood.vn "Pizza 4P's" ho chi minh`);
});
test('ShopeeFood accepts a street match without city or numbered-address evidence',async()=>{
 assert.equal((await lookup([{url:store,title:"Pizza 4P's - Hai Bà Trưng",snippet:''}],'151A-151B Hai Bà Trưng')).shopeeFoodUrl,store);
});
test('ShopeeFood rejects wrong names, unrelated locations, stale and non-store pages',async()=>{
 for(const row of [
  {url:store,title:'Another restaurant',snippet:'Hai Bà Trưng'},
  {url:'https://shopeefood.vn/ha-noi/pizza-4p-s',title:"Pizza 4P's",snippet:'Hà Nội'},
  {url:store,title:"Pizza 4P's",snippet:'Not found'},
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
