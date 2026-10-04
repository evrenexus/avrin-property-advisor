const fs = require("fs");

const MAX_AGE_HOURS = 14 * 24;
const MAX_LISTING_LINKS_PER_CITY = Number(process.env.AVRIN_MAX_LINKS || 20);
const DETAIL_CONCURRENCY = Number(process.env.AVRIN_DETAIL_CONCURRENCY || 2);
const DETAIL_DELAY_MS = Number(process.env.AVRIN_DETAIL_DELAY_MS || 1500);
const DETAIL_MAX_RETRIES = 5;
const DETAIL_RETRY_BASE_MS = 5000;

const LIST_API = "https://api.divar.ir/v8/postlist/w/search";
const DETAIL_API = "https://api.divar.ir/v8/posts-v2/web/";
const CITY_API = "https://api.divar.ir/v8/places/cities";

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function normalizeDigits(value = "") {
  return String(value).replace(/[۰-۹]/g, d => "۰۱۲۳۴۵۶۷۸۹".indexOf(d))
    .replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d));
}
function clean(value = "") {
  return normalizeDigits(value).replace(/\u200c/g, " ").replace(/\s+/g, " ").trim();
}
function toNumber(value) {
  const s = clean(value).replace(/[,٬\s]/g, "").replace(/[^\d]/g, "");
  return s ? Number(s) : null;
}
function firstNumberAfter(lines, label, validator) {
  const i = lines.indexOf(label);
  if (i < 0) return null;
  for (let j=i+1;j<=i+5 && j<lines.length;j++) {
    const n=toNumber(lines[j]);
    if(n!==null && validator(n)) return n;
  }
  return null;
}
function extractArea(lines){return firstNumberAfter(lines,"متراژ",n=>n>=15&&n<=5000)}
function extractBuildYear(lines){return firstNumberAfter(lines,"ساخت",n=>n>=1200&&n<=1500)}
function extractRooms(lines){
  const i=lines.indexOf("اتاق"); if(i<0)return null;
  for(let j=i+1;j<=i+5&&j<lines.length;j++){
    const v=clean(lines[j]); if(v==="بدون اتاق")return 0;
    const n=toNumber(v); if(n!==null&&n>=0&&n<=20&&/^\d+$/.test(normalizeDigits(v)))return n;
  }
  return null;
}
function extractPrice(lines){
  const i=lines.indexOf("قیمت کل"); if(i<0)return null;
  for(let j=i+1;j<=i+5&&j<lines.length;j++){const n=toNumber(lines[j]);if(n!==null&&n>=1000000)return n}
  return null;
}
function extractPricePerMeter(lines){
  const i=lines.indexOf("قیمت هر متر"); if(i<0)return null;
  for(let j=i+1;j<=i+5&&j<lines.length;j++){const n=toNumber(lines[j]);if(n!==null&&n>=100000)return n}
  return null;
}
function extractFloor(lines){
  const i=lines.indexOf("طبقه"); if(i<0)return null;
  for(let j=i+1;j<=i+5&&j<lines.length;j++){const v=clean(lines[j]);if(v&&v.length<=30)return v}
  return null;
}
function extractUnits(lines){
  for(const label of ["تعداد واحد","تعداد واحدها","واحد"]){
    const i=lines.indexOf(label); if(i<0)continue;
    for(let j=i+1;j<=i+4&&j<lines.length;j++){
      const v=normalizeDigits(clean(lines[j])),n=toNumber(v);
      if(n!==null&&n>=1&&n<=500&&/^\d+$/.test(v))return n;
    }
  }
  return null;
}
function extractImages(detail){
  const images=[];
  const seen=new Set();
  function walk(v){
    if(!v||typeof v!=="object")return;
    if(Array.isArray(v)){v.forEach(walk);return}
    for(const [k,val] of Object.entries(v)){
      if(typeof val==="string" && /image|photo|url|src/i.test(k) && /^https?:\\/\\//.test(val)){
        if(/\\.(jpg|jpeg|png|webp)(?:\\?|$)/i.test(val) || /images|image|photo|media/i.test(val)){
          if(!seen.has(val)){seen.add(val);images.push(val)}
        }
      } else if(val&&typeof val==="object") walk(val);
    }
  }
  walk(detail);
  return images.slice(0,20);
}
function collectWidgets(detail){
  const widgets=[];
  if(Array.isArray(detail?.sections))for(const section of detail.sections)
    if(Array.isArray(section?.widgets))widgets.push(...section.widgets);
  return widgets;
}
function extractLines(detail){
  const lines=[];
  for(const widget of collectWidgets(detail)){
    const wt=widget?.widget_type,data=widget?.data||{};
    if(wt==="GROUP_INFO_ROW")for(const item of data.items||[]){
      if(item?.title)lines.push(clean(item.title));
      if(item?.value!=null)lines.push(clean(item.value));
    }
    else if(wt==="UNEXPANDABLE_ROW"){
      if(data.title)lines.push(clean(data.title));
      if(data.value!=null)lines.push(clean(data.value));
    }
    else if(wt==="FEATURE_ROW"&&data.title)lines.push(clean(data.title));
    else if(wt==="GROUP_FEATURE_ROW")for(const item of data.items||[])
      if(item?.title)lines.push(clean(item.title));
  }
  return lines.filter(Boolean);
}
function allText(detail){
  const out=[];
  function walk(v){
    if(typeof v==="string"){const s=clean(v);if(s)out.push(s)}
    else if(Array.isArray(v))v.forEach(walk);
    else if(v&&typeof v==="object")Object.values(v).forEach(walk);
  }
  walk(detail); return out;
}
function parseTimestamp(value){
  if(value==null||value==="")return null;
  const raw=String(value).trim();
  if(/^\d+(\.\d+)?$/.test(raw)){const n=Number(raw);return new Date(n<1e12?n*1000:n)}
  const d=new Date(raw); return Number.isNaN(d.getTime())?null:d;
}
function recentEnough(value){
  const d=parseTimestamp(value);
  return !d || Date.now()-d.getTime()<=MAX_AGE_HOURS*3600000;
}
function sellerIsAgency(text){return /آژانس املاک|مشاور املاک|دفتر املاک|بنگاه املاک|مشاور شما/.test(text)}
function propertyType(lines){
  const text=lines.join(" ");
  if(/زمین|کلنگی/.test(text))return "زمین و کلنگی";
  if(/ویلا|خانه و ویلا/.test(text))return "خانه و ویلا";
  if(/مغازه|تجاری|دفتر کار|صنعتی/.test(text))return "املاک تجاری";
  return "آپارتمان";
}
function displayTitle({type,area,rooms,city,neighborhood}){
  const p=[type||"ملک"];
  if(area)p.push(area+" متر");
  if(rooms!==null)p.push(rooms===0?"بدون اتاق":rooms+" خوابه");
  const place=[neighborhood,city].filter(Boolean).join(" / ");
  if(place)p.push(place);
  return p.join("، ");
}
async function fetchJson(url,options={},retries=4){
  for(let attempt=0;attempt<=retries;attempt++){
    const r=await fetch(url,options);
    if(r.ok)return r.json();
    if(![429,500,502,503,504].includes(r.status)||attempt===retries)throw new Error("HTTP "+r.status);
    const ra=Number(r.headers.get("retry-after"));
    await sleep(Number.isFinite(ra)&&ra>0?ra*1000:3000*Math.pow(2,attempt));
  }
}
async function getCities(){
  const r=await fetch(CITY_API,{headers:{"User-Agent":"Mozilla/5.0"}});
  if(!r.ok)throw new Error("City API HTTP "+r.status);
  const data=await r.json(),raw=Array.isArray(data)?data:(data.cities||data.data||[]);
  const cities=raw.map(c=>({id:c.id??c.city_id??c.cityId,slug:c.slug||c.city_slug||c.citySlug,display:c.display||c.name||c.title||c.slug}))
    .filter(c=>c.id!=null&&typeof c.slug==="string");
  // Avrin scope: selected major markets only (plus key surrounding cities).
  const selectedCities = new Set([
    "تهران","کرج","مشهد","شیراز","اصفهان","تبریز","قم","ارومیه","اردبیل","زنجان","قزوین","خوی","سلماس",
    "رشت","بندر انزلی","انزلی","لاهیجان","لنگرود","رودسر","آستارا","تالش",
    "ساری","بابل","آمل","قائم شهر","نکا","نوشهر","چالوس","رامسر","تنکابن","محمودآباد","فریدونکنار",
    "گرگان","همدان","کرمان","یزد","چابهار","قشم","کیش","بندرعباس","اهواز","یاسوج","شهرکرد",
    "اسلامشهر","شهریار","قدس","ملارد","رباط کریم","پرند","پاکدشت","ورامین","قرچک","پردیس","بومهن","دماوند","رودهن","شمیرانات","لواسان",
    "فردیس","نظرآباد","هشتگرد","ساوجبلاغ","محمدشهر","مشکین دشت","ماهدشت","کمالشهر","طالقان"
  ]);
  const normalizedSelected = value => clean(value).replace(/[\u200c]/g, " ").replace(/\s+/g, " ").trim();
  const filtered = cities.filter(c => selectedCities.has(normalizedSelected(c.display)));
  if(!filtered.length)throw new Error("No selected Divar cities matched");
  console.log("AVRIN SELECTED CITIES", filtered.length, filtered.map(c=>c.display).join(" | "));
  const selectedIds = new Set(filtered.map(c=>String(c.id)));
  const finalCities = cities.filter(c=>selectedIds.has(String(c.id)));
  fs.writeFileSync("data/cities.json",JSON.stringify(finalCities,null,2));
  return finalCities;
}
async function getListingLinks(city){
  const result=[],seen=new Set();
  for(const category of ["apartment-sell","house-villa-sell"]){
    let pagination=null;
    for(let page=0;page<20&&result.length<MAX_LISTING_LINKS_PER_CITY;page++){
      const body={city_ids:[String(city.id)],search_data:{form_data:{data:{category:{str:{value:category}}}}}};
      if(pagination)body.pagination_data=pagination;
      const data=await fetchJson(LIST_API,{method:"POST",headers:{"User-Agent":"Mozilla/5.0","Content-Type":"application/json"},body:JSON.stringify(body)});
      for(const widget of data.list_widgets||[]){
        if(widget?.widget_type!=="POST_ROW")continue;
        const p=widget?.data?.action?.payload||{},token=p.token;
        if(!token||seen.has(token)||!recentEnough(widget.sort_date))continue;
        seen.add(token);
        result.push({token,url:"https://divar.ir/v/"+token,city:p?.web_info?.city_persian||city.display,neighborhood:p?.web_info?.district_persian||null,originalTitle:p?.web_info?.title||"",publishedAt:widget.sort_date||null});
        if(result.length>=MAX_LISTING_LINKS_PER_CITY)break;
      }
      const pg=data.pagination||{};
      if(!pg.has_next_page||!pg.data)break;
      pagination=pg.data; await sleep(250);
    }
  }
  return result;
}
async function readListing(item){
  for(let attempt=0;attempt<=DETAIL_MAX_RETRIES;attempt++){
    const r=await fetch(DETAIL_API+encodeURIComponent(item.token),{headers:{"User-Agent":"Mozilla/5.0"}});
    if(r.ok){
      const detail=await r.json(),lines=extractLines(detail),text=allText(detail);
      if(sellerIsAgency(text.slice(0,3000).join(" ")))return null;
      const area=extractArea(lines),rooms=extractRooms(lines),price=extractPrice(lines);
      const published=parseTimestamp(item.publishedAt);
      const ageHours=published?Math.max(0,(Date.now()-published.getTime())/3600000):null;
      if(ageHours!==null&&ageHours>MAX_AGE_HOURS)return null;
      const type=propertyType(lines);
      return {id:item.token,displayTitle:displayTitle({type,area,rooms,city:item.city,neighborhood:item.neighborhood}),propertyType:type,dealType:"buy",area,rooms,buildYear:extractBuildYear(lines),floor:extractFloor(lines),units:extractUnits(lines),price,pricePerMeter:extractPricePerMeter(lines),city:item.city,neighborhood:item.neighborhood,sellerType:"personal",verified:text.some(x=>/تأیید شده|تایید شده|احراز هویت شده/.test(x)),images:extractImages(detail),publishedAt:item.publishedAt,ageHours:ageHours===null?null:Math.round(ageHours*100)/100,source:"divar",sourceUrl:item.url,token:item.token};
    }
    if(r.status!==429||attempt===DETAIL_MAX_RETRIES)throw new Error("Detail HTTP "+r.status);
    const ra=Number(r.headers.get("retry-after"));
    await sleep(Number.isFinite(ra)&&ra>0?ra*1000:DETAIL_RETRY_BASE_MS*Math.pow(2,attempt));
  }
}
(async()=>{
  const startedAt=new Date(),cities=await getCities(),finalListings=[],seen=new Set();
  console.log("AVRIN MANUAL REFRESH START",startedAt.toISOString(),"cities",cities.length);
  let n=0;
  for(const city of cities){
    n++;
    let links=[];
    try{links=await getListingLinks(city)}catch(e){console.log("CITY LIST ERROR",city.slug,e.message);continue}
    for(let i=0;i<links.length;i+=DETAIL_CONCURRENCY){
      const batch=links.slice(i,i+DETAIL_CONCURRENCY);
      const results=await Promise.all(batch.map(async item=>{try{return await readListing(item)}catch(e){console.log("DETAIL ERROR",item.token,e.message);return null}}));
      for(const listing of results)if(listing&&!seen.has(listing.token)){seen.add(listing.token);finalListings.push(listing)}
      if(i+DETAIL_CONCURRENCY<links.length)await sleep(DETAIL_DELAY_MS);
    }
    console.log("CITY",n+"/"+cities.length,city.slug,"links",links.length,"saved",finalListings.length);
  }
  finalListings.sort((a,b)=>(parseTimestamp(b.publishedAt)?.getTime()||0)-(parseTimestamp(a.publishedAt)?.getTime()||0));
  fs.mkdirSync("data",{recursive:true});
  fs.writeFileSync("data/listings.json",JSON.stringify(finalListings,null,2));
  fs.writeFileSync("data/listings-meta.json",JSON.stringify({updatedAt:new Date().toISOString(),startedAt:startedAt.toISOString(),citiesScanned:cities.length,listingsSaved:finalListings.length,maxAgeHours:MAX_AGE_HOURS,maxLinksPerCity:MAX_LISTING_LINKS_PER_CITY,source:"divar"},null,2));
  console.log("AVRIN MANUAL REFRESH DONE",finalListings.length);
})();