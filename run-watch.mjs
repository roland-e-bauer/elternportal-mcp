import {spawnSync} from 'node:child_process';
// Keep credentials available for both phases, including after a failed fetch.
const fetchResult=spawnSync(process.execPath,[new URL('./watch.mjs',import.meta.url).pathname],{stdio:'inherit'});
const sendResult=spawnSync(process.execPath,[new URL('./send-notifications.mjs',import.meta.url).pathname],{stdio:'inherit'});
process.exitCode=fetchResult.status===0&&sendResult.status===0?0:1;
