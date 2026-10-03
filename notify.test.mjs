import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {dispatch,attachmentsFor,pushMessages} from './notify.mjs';
test('push contains current substitutions and preserves long unicode notices',()=>{
 const report={changes:{substitutions:true},substitutions:{plans:[{date:'2026-09-24',entries:[{Stunde:'7–8',Fach:'Englisch',Raum:'A160',Text:'Entfall'}],notices:['ü'.repeat(4000)]},{stale:true,entries:[{Text:'OLD'}]}]}};
 const parts=pushMessages(report);assert.ok(parts.length>1);assert.ok(parts.every(p=>Buffer.byteLength(p)<4096));
 const joined=parts.map(p=>p.replace(/^Teil \d+\/\d+\n/,'')).join('');
 assert.match(joined,/Stunde: 7–8.*Fach: Englisch.*Entfall/);assert.ok(joined.includes('ü'.repeat(4000)));assert.ok(!joined.includes('OLD'));
});
test('partial delivery retries only failed recipient',async()=>{
 const root=await mkdtemp(join(tmpdir(),'whg-notify-'));
 try{await mkdir(join(root,'outbox'));await writeFile(join(root,'outbox','1.json'),JSON.stringify({test:true}));
 const config={recipients:['a@example.org','b@example.org'],from:'test@example.org'};let pushes=0,calls=[];
 await assert.rejects(dispatch(root,config,{sendMail:async m=>{calls.push(m.to);if(m.to.startsWith('b'))throw Error();return {accepted:[m.to]};},push:async()=>{pushes++;}}));
 await dispatch(root,config,{sendMail:async m=>{calls.push(m.to);return {accepted:[m.to]};},push:async()=>{pushes++;}});
 assert.deepEqual(calls,['a@example.org','b@example.org','b@example.org']);assert.equal(pushes,1);assert.deepEqual(await readdir(join(root,'outbox')),[]);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('attachments outside archive cannot be sent',async()=>{
 const root=await mkdtemp(join(tmpdir(),'whg-attachment-'));
 try{await mkdir(join(root,'attachments'));await writeFile(join(root,'private.txt'),'secret');await assert.rejects(attachmentsFor({letters:[{files:[{path:join(root,'private.txt')}]}]},root),/INVALID_ATTACHMENT/);}finally{await rm(root,{recursive:true,force:true});}
});
