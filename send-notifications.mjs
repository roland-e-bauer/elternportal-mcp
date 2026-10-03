import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {dispatch} from './notify.mjs';
try{
 const root=process.env.WHG_STATE_DIR||'/var/lib/whg-elternportal';
 const config=JSON.parse(await readFile(join(process.env.CREDENTIALS_DIRECTORY,'notify.json'),'utf8'));
 if(process.argv.includes('--test')){await mkdir(join(root,'outbox'),{recursive:true,mode:0o700});await writeFile(join(root,'outbox',Date.now()+'.json'),JSON.stringify({test:true,checkedAt:new Date().toISOString()}),{mode:0o600});}
 console.log(JSON.stringify({delivery:'OK',...await dispatch(root,config)}));
}catch(e){console.error('WHG_DELIVERY_FAILED: pending messages retained. Code: '+(e.code||'DELIVERY_FAILED'));process.exitCode=1;}
