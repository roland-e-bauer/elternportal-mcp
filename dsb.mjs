import { load } from 'cheerio';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { readSecret } from './credentials.mjs';

export function validDsbUrl(value) {
  const url = new URL(value);
  if(url.protocol !== 'https:' || url.hostname !== 'light.dsbcontrol.de' || url.username || url.password || (url.port && url.port !== '443')) throw new Error('DSB_URL_BLOCKED');
  return url;
}
export function matchesClass(value, target) {
  return value.split(/[,;\s]+/).some(s => s.replace(/^0+/, '').toLowerCase() === target.replace(/^0+/, '').toLowerCase());
}
export function parseDsbPage(html, className, updatedAt) {
  const $ = load(html);
  $('script,style').remove();
  const heading = $('.mon_title').text().trim();
  const match = heading.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})\b/);
  const table = $('table.mon_list');
  if(!match || table.length !== 1) throw new Error('DSB_LAYOUT_UNRECOGNIZED');
  const date = `${match[3]}-${match[2].padStart(2,'0')}-${match[1].padStart(2,'0')}`;
  const headers = table.find('tr').first().children('th,td').map((_i,c)=>$(c).text().trim()).get();
  const classIndex = headers.findIndex(h=>/^Klasse/i.test(h));
  if(classIndex < 0 || !headers.includes('Stunde')) throw new Error('DSB_LAYOUT_UNRECOGNIZED');
  const entries=[];
  let total=0;
  table.find('tr').slice(1).each((_i,row)=>{
    const cells = $(row).children('td').map((_j,c)=>{const v=$(c).clone();v.find('br').replaceWith('\n');return v.text().trim();}).get();
    if(!cells.length) return;
    if(cells.length !== headers.length) throw new Error('DSB_LAYOUT_UNRECOGNIZED');
    total++;
    if(matchesClass(cells[classIndex],className)) entries.push(Object.fromEntries(headers.map((h,i)=>[h,cells[i]])));
  });
  const notices=$('table.info tr').map((_i,row)=>$(row).children('td').map((_j,c)=>$(c).text().trim()).get().join(' ')).get().filter(Boolean);
  const pageUpdated=$('table.mon_head').text().match(/Stand:\s*(\d{2}\.\d{2}\.\d{4}\s+\d{2}:\d{2})/)?.[1];
  const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Berlin'}).format(new Date());
  return {date,heading,lastUpdated:pageUpdated || updatedAt,stale:date<today,className,entries,totalEntriesOnPage:total,notices,noticeScope:'Tageshinweise der gesamten Schule, koennen andere Klassen betreffen',note:'Originale Portalspalten; ? kennzeichnet Aenderungen. Eintraege fuer Jgst. 12 koennen einzelne Kurse betreffen. Fehlende Eintraege bedeuten keinen Unterrichtsausfall.'};
}

export async function getDsbPlans(className) {
  let secret;
  try {
    secret=readSecret('dsb');
  } catch {throw new Error('DSB_SECRET_UNAVAILABLE');}
  const request=async url=>{const r=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(20000)});if(!r.ok)throw new Error('DSB_REQUEST_FAILED');return r;};
  try {
    const auth=new URL('https://mobileapi.dsbcontrol.de/authid');
    auth.search=new URLSearchParams({bundleid:'de.heinekingmedia.dsbmobile',appversion:'35',osversion:'22',pushid:'',user:secret.user,password:secret.password});
    const token=await (await request(auth)).json();
    secret.user='';secret.password='';auth.search='';
    if(typeof token !== 'string' || !token)throw new Error('DSB_LOGIN_FAILED');
    const items=await (await request('https://mobileapi.dsbcontrol.de/dsbtimetables?'+new URLSearchParams({authid:token}))).json();
    if(!Array.isArray(items))throw new Error('DSB_INVALID_RESPONSE');
    const pages=[];
    const walk=(item,parent)=>{if(item.Detail)pages.push({url:item.Detail,updatedAt:item.Date||parent?.Date});for(const child of item.Childs||[])walk(child,item);};
    for(const item of items)walk(item);
    const unique=[...new Map(pages.map(p=>[p.url,p])).values()];
    if(unique.length>20)throw new Error('DSB_TOO_MANY_PAGES');
    const plans=[];
    for(const page of unique){
      const response=await request(validDsbUrl(page.url));
      const bytes=await response.arrayBuffer();
      if(bytes.byteLength>5*1024*1024)throw new Error('DSB_INVALID_RESPONSE');
      const prefix=new TextDecoder().decode(bytes.slice(0,2000));
      const charset=/charset\s*=\s*["']?utf-8/i.test(prefix+' '+response.headers.get('content-type'))?'utf-8':'windows-1252';
      plans.push(parseDsbPage(new TextDecoder(charset).decode(bytes),className,page.updatedAt));
    }
    return {source:'DSBmobile WHG',checkedAt:new Date().toISOString(),status:plans.length?'available':'no_published_plans',className,plans:plans.sort((a,b)=>a.date.localeCompare(b.date)),complete:true};
  } catch(error) {
    const allowed=new Set(['DSB_URL_BLOCKED','DSB_LAYOUT_UNRECOGNIZED','DSB_REQUEST_FAILED','DSB_LOGIN_FAILED','DSB_INVALID_RESPONSE','DSB_TOO_MANY_PAGES']);
    throw new Error(allowed.has(error?.message)?error.message:'DSB_REQUEST_FAILED');
  } finally {secret.user='';secret.password='';}
}
