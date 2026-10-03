import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { buildServer } from './mcp-server.mjs';
import { createPortal, normalizeLetters, recoverLetterTitles, parseTimetable, letterDetails, assertReadRequest } from './portal.mjs';

test('letter text preserves paragraphs and deduplicates attachments; unsafe links are excluded', () => {
 const d=letterDetails('<table><tr><td>#60</td></tr><tr><td><h4>Title</h4><p>First</p><p>Second</p><a href="aktuelles/get_file/?repo=1&csrf=x">Title</a><a href="aktuelles/get_file/?repo=1&csrf=y">file.pdf</a><a href="https://evil.invalid/aktuelles/get_file/?repo=2">bad</a><a href="/api/elternbrief_bestaetigen.php?eb=3">confirm</a></td></tr></table>',60);
 assert.equal(d.attachments.length,1);
 assert.equal(d.attachments[0].name,'file.pdf');
 assert.match(d.text,/First\nSecond/);
 assert.throws(()=>letterDetails('<table></table>',60),/LETTER_NOT_FOUND/);
 assert.throws(()=>assertReadRequest({url:'https://whgga.eltern-portal.org/api/elternbrief_bestaetigen.php?eb=3'}),/REQUEST_BLOCKED/);
 assert.throws(()=>assertReadRequest({url:'https://evil.invalid/file'}),/REQUEST_BLOCKED/);
});

test('timetable preserves headings, empty cells, line breaks and merged cells', () => {
  const result = parseTimetable('<div id="asam_content"><table><tr><th>Zeit</th><th>Montag</th></tr><tr><td rowspan="2">08:00</td><td>Mathematik<br>R1</td></tr><tr><td></td></tr><tr><td colspan="2">Hinweis</td></tr></table></div>');
  assert.equal(result.emptyUnverified, false);
  const rows = result.tables[0].rows;
  assert.equal(rows[0][1].text, 'Montag');
  assert.equal(rows[0][1].heading, true);
  assert.equal(rows[1][0].rowSpan, 2);
  assert.equal(rows[1][1].text, 'Mathematik\nR1');
  assert.equal(rows[2][0].text, '');
  assert.equal(rows[3][0].columnSpan, 2);
  assert.equal(parseTimetable('<div id="asam_content">Kein Plan</div>').emptyUnverified, true);
});

test('recover unlinked headings only by matching unambiguous letter ID', () => {
  const html = '<table><tr><td>#12</td></tr><tr><td><h4>Unlinked heading</h4></td></tr><tr><td>#13</td></tr><tr><td><h4>Other heading</h4></td></tr><tr><td>#13</td></tr><tr><td><h4>Duplicate heading</h4></td></tr></table>';
  const rows = [{id:12,title:''},{id:13,title:''},{id:14,title:''},{id:12,title:'Existing'}];
  const result = recoverLetterTitles(rows, html);
  assert.equal(result.recoveredTitles, 1);
  assert.deepEqual(result.letters.map(l => l.title), ['Unlinked heading','','','Existing']);
  assert.equal(rows[0].title, '');
  assert.equal(normalizeLetters(result.letters).diagnostics.missingTitles, 2);
});

test('incomplete letter metadata is preserved and flagged, never silently discarded', () => {
  const normalized = normalizeLetters([
    { id: 12, title: 'Complete', status: 'unread' },
    { id: NaN, title: 'No ID', messageText: 'Keep this content' },
    { id: 13, title: '', status: 'unexpected' }
  ]);
  assert.equal(normalized.letters.length, 3);
  assert.deepEqual(normalized.diagnostics, { missingIds: 1, missingTitles: 1 });
  assert.equal(normalized.needsReview, true);
  assert.equal(normalized.letters[1].id, null);
  assert.equal(normalized.letters[1].messageText, 'Keep this content');
  assert.equal(normalized.letters[2].status, 'unknown');
  assert.equal(normalized.letters[2].incomplete, true);
  assert.equal(normalizeLetters([]).letters.length, 0);
  assert.throws(() => normalizeLetters('<html>login</html>'), /INVALID_RESPONSE/);
  assert.throws(() => normalizeLetters([null]), /INVALID_RESPONSE/);
});

test('initial sentinel child does not reject a valid login; actual child selection stays checked', async () => {
  const oldUser = process.env.ELTERNPORTAL_USER;
  const oldPassword = process.env.ELTERNPORTAL_PASSWORD;
  let selectionReply = 0;
  let kidsReply = [{ id: 42, firstName: 'Test', lastName: 'Fixture', className: 'X' }];
  let cleared = 0;
  const fakeFactory = () => {
    let responseInterceptor;
    return {
      client: { defaults: {}, interceptors: { response: { use(fn) { responseInterceptor = fn; } } } },
      async init() { responseInterceptor({ config: { url: 'https://whgga.eltern-portal.org/api/set_child.php?id=0' }, data: 0 }); },
      async getKids() { return kidsReply; },
      async setKid(id) { responseInterceptor({ config: { url: `https://whgga.eltern-portal.org/api/set_child.php?id=${id}` }, data: selectionReply }); },
      async getElternbriefe() { return [{ id: 1, title: 'Fixture' }]; },
      jar: { async removeAllCookies() { cleared++; } }
    };
  };
  try {
    process.env.ELTERNPORTAL_USER = 'fixture';
    process.env.ELTERNPORTAL_PASSWORD = 'fixture';
    const portal = createPortal(fakeFactory);
    assert.equal((await portal('children')).children.length, 1);
    await assert.rejects(portal('letters', { childId: 42, offset: 0, limit: 25 }), /CHILD_SELECTION_FAILED/);
    selectionReply = '1';
    assert.equal((await portal('letters', { childId: 42, offset: 0, limit: 25 })).letters.length, 1);
    kidsReply = [];
    await assert.rejects(portal('children'), /LOGIN_OR_PARSER_FAILED/);
    assert.equal(cleared, 4);
  } finally {
    if (oldUser === undefined) delete process.env.ELTERNPORTAL_USER; else process.env.ELTERNPORTAL_USER = oldUser;
    if (oldPassword === undefined) delete process.env.ELTERNPORTAL_PASSWORD; else process.env.ELTERNPORTAL_PASSWORD = oldPassword;
  }
});

test('MCP discovery, input validation, pagination defaults and secret-safe errors', async () => {
  const calls = [];
  const server = buildServer(async (kind, args) => {
    calls.push({ kind, args });
    if (kind === 'events') throw new Error('password=DO_NOT_LEAK cookie=PRIVATE');
    return { kind, args };
  });
  const client = new Client({ name: 'test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  await client.connect(b);
  try {
    const listing = await client.listTools();
    assert.deepEqual(listing.tools.map(t => t.name).sort(), ['download_letter_attachment','get_parent_letter','get_substitutions','get_timetable','list_children','list_events','list_exams','list_parent_letters']);
    assert.ok(listing.tools.filter(t => t.name !== 'download_letter_attachment').every(t => t.annotations.readOnlyHint));
    await client.callTool({ name: 'list_parent_letters', arguments: { childId: 3 } });
    assert.deepEqual(calls[0], { kind: 'letters', args: { childId: 3, offset: 0, limit: 25 } });
    const invalid = await client.callTool({ name: 'list_parent_letters', arguments: { limit: 101 } });
    assert.equal(invalid.isError, true);
    assert.equal(calls.length, 1);
    const error = await client.callTool({ name: 'list_events', arguments: {} });
    assert.equal(error.isError, true);
    assert.equal(error.content[0].text, 'PORTAL_REQUEST_FAILED');
    assert.ok(!JSON.stringify(error).includes('DO_NOT_LEAK'));
  } finally { await client.close(); await server.close(); }
});

test('real stdio process starts without secrets and rejects portal access safely', async () => {
  const client = new Client({ name: 'stdio-test', version: '1' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('./mcp-server.mjs', import.meta.url))], env: { ELTERNPORTAL_USER: '', ELTERNPORTAL_PASSWORD: '' }, stderr: 'pipe' });
  try {
    await client.connect(transport);
    assert.equal((await client.listTools()).tools.length, 8);
    const response = await client.callTool({ name: 'list_children', arguments: {} });
    assert.equal(response.isError, true);
    assert.equal(response.content[0].text, 'MISSING_SECRETS');
  } finally { await client.close(); }
});
