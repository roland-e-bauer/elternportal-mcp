import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {readSecret} from './credentials.mjs';
import {createPortal} from './portal.mjs';
const root=process.env.WHG_STATE_DIR || '/var/lib/whg-elternportal';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function save(name,value){const path=join(root,name);await writeFile(path+'.tmp',JSON.stringify(value,null,2),{mode:0o600});await rename(path+'.tmp',path);}
try {
 await mkdir(root,{recursive:true,mode:0o700});
 let previous=null;try{previous=JSON.parse(await readFile(join(root,'state.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
 const s=readSecret('portal');process.env.ELTERNPORTAL_USER=s.user;process.env.ELTERNPORTAL_PASSWORD=s.password;s.user='';s.password='';
 const portal=createPortal();
 const kids=(await portal('children')).children;
 if(kids.length!==1)throw new Error('CHILD_SELECTION_REQUIRED');
 const childId=kids[0].id;
 const substitutions=await portal('substitutions',{childId});
 const exams=await portal('exams',{childId});
 const events=await portal('events',{});
 const letters=[];
 for(let offset=0;offset<1000;offset+=100){const page=await portal('letters',{childId,offset,limit:100});letters.push(...page.letters);if(letters.length>=page.total)break;if(offset===900)throw new Error('LETTER_LIMIT');}
 const fingerprints=Object.fromEntries(letters.map(l=>[l.id,hash({title:l.title,date:l.date,messageText:l.messageText})]));
 const changedLetters=previous?letters.filter(l=>previous.letters[l.id]!==fingerprints[l.id]):[];
 const details=[];
 for(const letter of changedLetters){const detail=await portal('letter',{childId,letterId:letter.id});const files=[];for(const a of detail.attachments){files.push(await portal('download',{childId,letterId:letter.id,attachmentId:a.attachmentId}));}details.push({...detail,files});}
 const plans=substitutions.plans.filter(p=>!p.stale).map(p=>({date:p.date,entries:p.entries,notices:p.notices}));
 const current={letters:fingerprints,plans:hash(plans),exams:hash(exams.rows),events:hash(events.events)};
 const changes={newOrChangedLetters:changedLetters.length,substitutions:!!previous&&previous.plans!==current.plans,exams:!!previous&&previous.exams!==current.exams,events:!!previous&&previous.events!==current.events};
 const report={checkedAt:new Date().toISOString(),baseline:!previous,changes,substitutions,exams,events,letters:details,notification:'queued_if_changed'};
 await save('latest.json',report);
 if(previous && (changedLetters.length||changes.substitutions||changes.exams||changes.events)){
  await mkdir(join(root,'outbox'),{recursive:true,mode:0o700});
  await save('outbox/'+Date.now()+'.json',report);
 }
 await save('state.json',current);
 await save('health.json',{ok:true,checkedAt:report.checkedAt});
 console.log(JSON.stringify({ok:true,baseline:!previous,children:kids.length,letters:letters.length,plans:substitutions.plans.length,...changes}));
}catch{
 await mkdir(root,{recursive:true,mode:0o700});
 await save('health.json',{ok:false,checkedAt:new Date().toISOString(),reason:'FETCH_FAILED'});
 console.error('WHG_CHECK_FAILED: no successful result assumed.');process.exitCode=1;
}
