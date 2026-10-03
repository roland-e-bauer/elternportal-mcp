import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
const client = new Client({ name: 'local-check', version: '1.0.0' });
const transport = new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('./mcp-server.mjs', import.meta.url))], env: { ELTERNPORTAL_USER: process.env.ELTERNPORTAL_USER || '', ELTERNPORTAL_PASSWORD: process.env.ELTERNPORTAL_PASSWORD || '' }, stderr: 'ignore' });
const report = { checkedAt: new Date().toISOString(), steps: [] };
let stage = 'MCP-Verbindung';
let reason = 'MCP_OR_RESPONSE_FAILED';
try {
  await client.connect(transport);
  const { tools } = await client.listTools();
  if (tools.length !== 8) throw new Error();
  report.steps.push({ step: stage, status: 'OK', tools: tools.length });
  let childId;
  for (const [name, key] of [['list_children','children'], ['list_events','events'], ['list_parent_letters','letters']]) {
    stage = name;
    const result = await client.callTool({ name, arguments: name === 'list_parent_letters' ? { childId, limit: 100 } : {} }, undefined, { timeout: 120000 });
    if (result.isError) {
      const code = result.content?.find(item => item.type === 'text')?.text;
      const safe = new Set(['MISSING_SECRETS', 'REDIRECT_BLOCKED', 'LOGIN_FAILED', 'INVALID_RESPONSE', 'CHILD_SELECTION_FAILED', 'LOGIN_OR_PARSER_FAILED', 'INVALID_DATE_RANGE', 'CHILD_ID_REQUIRED_OR_INVALID', 'PORTAL_REQUEST_FAILED']);
      reason = safe.has(code) ? code : 'MCP_OR_RESPONSE_FAILED';
      throw new Error();
    }
    const data = JSON.parse(result.content[0].text);
    if (!Array.isArray(data[key])) throw new Error();
    if (key === 'children') childId = data.children[0]?.id;
    report.steps.push({ step: stage, status: data.emptyUnverified ? 'EMPTY_UNVERIFIED' : data.needsReview ? 'OK_WITH_WARNINGS' : 'OK', count: data[key].length, ...(key === 'letters' ? { missingIds: data.diagnostics?.missingIds, missingTitles: data.diagnostics?.missingTitles, recoveredTitles: data.diagnostics?.recoveredTitles } : {}) });
  }
} catch {
  report.steps.push({ step: stage, status: 'FAILED', reason });
  process.exitCode = 1;
} finally {
  await client.close();
  console.log(JSON.stringify(report, null, 2));
  writeFileSync(new URL('./mcp-status.json', import.meta.url), JSON.stringify(report, null, 2));
}
