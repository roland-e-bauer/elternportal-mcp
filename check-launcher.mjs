import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
const client = new Client({name:'launcher-test',version:'1'});
const transport = new StdioClientTransport({command:process.execPath, args:[fileURLToPath(new URL('./secret-launcher.mjs',import.meta.url)),'--secret-path',process.argv[2]], stderr:'pipe'});
try {
  await client.connect(transport);
  if ((await client.listTools()).tools.length !== 8) throw new Error();
  console.log('Encrypted secret launcher: MCP handshake and 8 tools OK. No portal request made.');
} finally { await client.close(); }
