import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { buildServer } from './mcp-server.mjs';
import { createPortal } from './portal.mjs';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readSecret } from './credentials.mjs';
try {
  const index = process.argv.indexOf('--secret-path');
  const secretPath = index >= 0 ? process.argv[index + 1] : undefined;
  // Decrypted values travel only through a private child-process pipe, never a terminal.
  const secrets = readSecret('portal',secretPath);
  if (typeof secrets.user !== 'string' || !secrets.user || typeof secrets.password !== 'string' || !secrets.password) throw new Error();
  process.env.ELTERNPORTAL_USER = secrets.user;
  process.env.ELTERNPORTAL_PASSWORD = secrets.password;
  secrets.user = ''; secrets.password = '';
  if (process.argv.includes('--check')) {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('./check-mcp.mjs',import.meta.url))], {stdio:'inherit', windowsHide:true});
    delete process.env.ELTERNPORTAL_USER; delete process.env.ELTERNPORTAL_PASSWORD;
    process.exitCode = result.status ?? 1;
  } else {
    await buildServer(createPortal()).connect(new StdioServerTransport());
  }
} catch {
  delete process.env.ELTERNPORTAL_USER; delete process.env.ELTERNPORTAL_PASSWORD;
  process.stderr.write('WHG_START_FAILED: Bitte Zugang-einrichten.cmd ausfuehren.\n');
  process.exitCode = 1;
}
