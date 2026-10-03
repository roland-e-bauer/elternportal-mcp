import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
export function readSecret(name, windowsPath) {
  if(!['portal','dsb'].includes(name)) throw new Error('SECRET_UNAVAILABLE');
  try {
    let secret;
    if(process.platform === 'win32') {
      const path=windowsPath || join(process.env.LOCALAPPDATA || join(process.env.USERPROFILE,'AppData','Local'),'WHGElternportal',name==='portal'?'credentials.xml':'dsb.xml');
      secret=JSON.parse(execFileSync('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',fileURLToPath(new URL('./Read-Secrets.ps1',import.meta.url)),'-SecretPath',path],{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','ignore'],timeout:15000}));
    } else {
      if(!process.env.CREDENTIALS_DIRECTORY)throw new Error();
      secret=JSON.parse(readFileSync(join(process.env.CREDENTIALS_DIRECTORY,name+'.json'),'utf8'));
    }
    if(typeof secret.user!=='string'||!secret.user||typeof secret.password!=='string'||!secret.password)throw new Error();
    return secret;
  } catch { throw new Error('SECRET_UNAVAILABLE'); }
}
