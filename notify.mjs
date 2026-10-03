import {readFile,writeFile,rename,mkdir,readdir,realpath} from 'node:fs/promises';
import {join,relative,isAbsolute} from 'node:path';
import nodemailer from 'nodemailer';

async function save(path,data){await writeFile(path+'.tmp',JSON.stringify(data,null,2),{mode:0o600});await rename(path+'.tmp',path);}
export function pushMessages(r){
 const lines=[];
 if(r.test)lines.push('WHG Elternportal: Verbindungstest.');
 else if(r.changes?.substitutions){
  lines.push('Vertretungsplan aktualisiert – Jahrgang, persönliche Kurse beachten.');
  const plans=(r.substitutions?.plans||[]).filter(p=>!p.stale);
  if(!plans.length)lines.push('Kein aktueller Plan veröffentlicht. Das bedeutet nicht, dass es keine Vertretungen gibt.');
  for(const p of plans){
   lines.push('',p.heading||p.date);
   if(p.lastUpdated)lines.push('Stand: '+p.lastUpdated);
   for(const e of p.entries)lines.push(Object.entries(e).filter(([,v])=>String(v).trim()).map(([k,v])=>`${k}: ${String(v).replace(/\s+/g,' ').trim()}`).join(' · '));
   if(!p.entries.length)lines.push('Keine Einträge für diesen Jahrgang im veröffentlichten Plan.');
   if(p.notices?.length)lines.push('Schulweite Hinweise:',...p.notices);
  }
 }else lines.push('Neue WHG-Mitteilung. Details stehen in der E-Mail.');
 if(r.changes?.newOrChangedLetters)lines.push(`${r.changes.newOrChangedLetters} neue/geänderte Elternbriefe – siehe E-Mail.`);
 if(r.changes?.events||r.changes?.exams)lines.push('Auch Termine/Schulaufgaben wurden aktualisiert – siehe E-Mail.');
 // ntfy has a 4096-byte message limit. Split by UTF-8 bytes without losing text.
 const chunks=[];let chunk='';
 for(const c of lines.join('\n')){if(Buffer.byteLength(chunk+c,'utf8')>3500){chunks.push(chunk);chunk='';}chunk+=c;}
 if(chunk)chunks.push(chunk);
 return chunks.map((text,i)=>chunks.length>1?`Teil ${i+1}/${chunks.length}\n${text}`:text);
}
export function reportText(r){
 if(r.test)return 'WHG Elternportal: Testnachricht. E-Mail und ntfy werden eingerichtet. Diese Nachricht enthält keine Schuldaten.';
 const date=(value,time=false)=>{if(!value)return 'Datum nicht angegeben';const d=new Date(/^\d{4}-\d{2}-\d{2}$/.test(value)?value+'T12:00:00Z':value);return Number.isNaN(d.getTime())?String(value):new Intl.DateTimeFormat('de-DE',{timeZone:'Europe/Berlin',dateStyle:'full',...(time?{timeStyle:'short'}:{})}).format(d);};
 const clean=v=>String(v??'').replace(/\s+/g,' ').trim();
 const parts=['WHG Elternportal – Änderungen',`Guten Tag,\nbei der Prüfung am ${date(r.checkedAt,true)} wurden Änderungen festgestellt. Hier ist der aktuelle Stand der betroffenen Bereiche.`];
 if(r.changes?.substitutions){
  parts.push('Vertretungen');
  parts.push('Die folgenden Einträge gelten für den Jahrgang. Bitte prüfen Sie, welche davon die persönlichen Kurse betreffen.');
  const plans=(r.substitutions?.plans||[]).filter(p=>!p.stale);
  if(!plans.length)parts.push('Derzeit ist kein aktueller Vertretungsplan veröffentlicht. Daraus lässt sich nicht ableiten, dass es keine Vertretungen gibt.');
  for(const p of plans){
   parts.push(date(p.date)+(p.lastUpdated?'\nStand des Plans: '+p.lastUpdated:''));
   parts.push(p.entries.length?p.entries.map(e=>'• '+Object.entries(e).filter(([,v])=>clean(v)).map(([k,v])=>`${k}: ${clean(v)}`).join(' · ')).join('\n'):'Für diesen Jahrgang enthält der veröffentlichte Plan keine Einträge. Das bedeutet keinen Unterrichtsausfall.');
   if(p.notices?.length)parts.push('Hinweise für die gesamte Schule:\n'+p.notices.map(n=>'• '+clean(n)).join('\n'));
  }
 }
 if(r.letters?.length){parts.push('Elternbriefe');for(const l of r.letters){parts.push(l.title+'\n'+(l.text||'Der Brief enthält keinen auslesbaren Nachrichtentext. Bitte beachten Sie die Anhänge.'));if(l.files?.length)parts.push('Zugehörige Dateien:\n'+l.files.map(f=>'• '+(f.originalName||'Elternbrief-Anhang')).join('\n'));}}
 if(r.changes?.exams){parts.push('Schulaufgaben');parts.push(r.exams.rows.length?r.exams.rows.map(row=>'• '+row.map(clean).filter(Boolean).join(' – ')).join('\n'):'Im Portal sind derzeit keine Schulaufgaben eingetragen. Das bedeutet nicht, dass keine Prüfungen stattfinden.');}
 if(r.changes?.events){parts.push('Termine');parts.push(r.events.events.length?r.events.events.map(e=>`• ${date(e.startDate,true)}${e.endDate&&e.endDate!==e.startDate?' bis '+date(e.endDate,true):''}: ${e.title}`).join('\n'):'Im abgefragten Zeitraum sind derzeit keine Termine eingetragen.');}
 parts.push('Anhänge und Hinweise');
 parts.push('Neue Briefanhänge liegen zusätzlich im geschützten Archiv auf dem Ubuntu-Server. Bis zu insgesamt 15 MiB werden der E-Mail beigefügt; größere Dateien bleiben im Archiv. Empfangsbestätigungen werden nicht automatisch abgegeben.');
 return parts.join('\n\n');
}
export function reportHtml(r){
 const escape=s=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
 const headings=new Set(['Vertretungen','Elternbriefe','Schulaufgaben','Termine','Anhänge und Hinweise']);
 const blocks=reportText(r).split('\n\n').map((block,i)=>{
  if(i===0)return '<h1 style="font-size:24px;color:#173b64">'+escape(block)+'</h1>';
  if(headings.has(block))return '<h2 style="font-size:20px;color:#173b64;border-bottom:1px solid #d8e1eb;padding-bottom:8px">'+escape(block)+'</h2>';
  if(block.split('\n').every(line=>line.startsWith('• ')))return '<ul>'+block.split('\n').map(line=>'<li style="margin-bottom:10px">'+escape(line.slice(2))+'</li>').join('')+'</ul>';
  return '<p style="margin:16px 0">'+escape(block).replace(/\n/g,'<br>')+'</p>';
 });
 return '<!doctype html><html lang="de"><meta charset="utf-8"><body style="font-family:Arial,sans-serif;color:#243244;line-height:1.6;max-width:760px;margin:auto;padding:24px">'+blocks.join('\n')+'</body></html>';
}
export async function attachmentsFor(r,root){
 const files=(r.letters||[]).flatMap(l=>l.files||[]);if(!files.length)return [];
 const base=await realpath(join(root,'attachments'));let total=0;const attachments=[];
 for(const f of files){const path=await realpath(f.path);const rel=relative(base,path);if(rel.startsWith('..')||isAbsolute(rel))throw new Error('INVALID_ATTACHMENT');
  const content=await readFile(path);total+=content.length;if(total>15*1024*1024)continue;
  attachments.push({filename:f.originalName||'Elternbrief.pdf',content});
 }
 return attachments;
}
export async function dispatch(root,config,{sendMail,push}={}){
 const dir=join(root,'outbox');await mkdir(dir,{recursive:true,mode:0o700});
 const transport=sendMail?null:nodemailer.createTransport({...config.smtp,requireTLS:true,logger:false,debug:false,connectionTimeout:20000,socketTimeout:30000,disableFileAccess:true,disableUrlAccess:true});
 sendMail ||= msg=>transport.sendMail(msg);
 push ||= async body=>{const response=await fetch(config.ntfy,{method:'POST',headers:{Title:'WHG Elternportal'},body,signal:AbortSignal.timeout(20000)});if(!response.ok)throw new Error('PUSH_FAILED');};
 let failed=false,sent=0;
 try{for(const file of (await readdir(dir)).filter(f=>/^\d+\.json$/.test(f)).sort()){
  const path=join(dir,file),r=JSON.parse(await readFile(path,'utf8'));r.delivered ||= {};
  for(const recipient of config.recipients){const key='email:'+recipient;if(r.delivered[key])continue;
   try{const result=await sendMail({from:config.from,to:recipient,subject:r.test?'WHG Elternportal – Verbindungstest':'WHG Elternportal – neue Informationen',text:reportText(r),html:reportHtml(r),attachments:await attachmentsFor(r,root),messageId:`<whg-${file}-${config.recipients.indexOf(recipient)}@web.de>`});
    if(!result.accepted?.some(v=>v.toLowerCase()===recipient.toLowerCase()))throw new Error('MAIL_REJECTED');
    r.delivered[key]=true;await save(path,r);sent++;
   }catch{failed=true;}
  }
  if(!r.delivered.ntfy)try{
   const messages=pushMessages(r);
   for(let i=r.delivered.ntfyParts||0;i<messages.length;i++){await push(messages[i]);r.delivered.ntfyParts=i+1;await save(path,r);sent++;}
   r.delivered.ntfy=true;await save(path,r);
  }catch{failed=true;}
  if(config.recipients.every(a=>r.delivered['email:'+a])&&r.delivered.ntfy){await mkdir(join(root,'sent'),{recursive:true,mode:0o700});await rename(path,join(root,'sent',file));}
 }}finally{transport?.close();}
 await save(join(root,'delivery-health.json'),{ok:!failed,checkedAt:new Date().toISOString(),sent});
 if(failed)throw new Error('DELIVERY_FAILED');return {sent};
}
