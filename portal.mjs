import { ElternPortalApiClient } from '@philippdormann/elternportal-api';
import { load } from 'cheerio';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { parseExamPage } from './plans.mjs';
import { getDsbPlans } from './dsb.mjs';

const origin = 'https://whgga.eltern-portal.org';
export function letterDetails(html, id) {
  const $ = load(html); $('.hidden-lg,script,style').remove();
  const matches = $('tr').filter((_i, row) => $(row).children('td').first().text().trim().match(/^#?\s*(\d+)$/)?.[1] === String(id));
  if (matches.length !== 1) throw new Error('LETTER_NOT_FOUND');
  const row = matches.first().next('tr');
  const attachments = new Map();
  row.find('a[href]').each((_i, a) => {
    let url; try { url = new URL($(a).attr('href'), origin + '/'); } catch { return; }
    const repo = url.searchParams.get('repo');
    if (url.origin !== origin || url.pathname !== '/aktuelles/get_file/' || !/^\d+$/.test(repo || '')) return;
    const name = $(a).text().trim();
    if (!attachments.has(repo) || /\.[a-z0-9]{2,5}$/i.test(name)) attachments.set(repo, { attachmentId: repo, name, url: url.href });
  });
  row.find('br').replaceWith('\n');
  row.find('p,div').append('\n');
  return { id, title: row.find('h4').first().text().trim(), text: row.text().replace(/[ \t]+/g,' ').replace(/\n\s*\n/g,'\n').trim(), attachments: [...attachments.values()] };
}
export function assertReadRequest(config) {
  const url = new URL(config.url, origin);
  if (url.origin !== origin || /bestaetig/i.test(url.pathname)) throw new Error('REQUEST_BLOCKED');
  return config;
}
export function parseTimetable(html) {
  const $ = load(html || '');
  const tables = [];
  $('#asam_content table').each((_i, table) => {
    const rows = [];
    $(table).find('tr').filter((_j, tr) => $(tr).closest('table')[0] === table).each((_j, tr) => {
      const cells = $(tr).children('th,td').map((_k, cell) => {
        const copy = $(cell).clone();
        copy.find('br').replaceWith('\n');
        copy.find('script,style').remove();
        return { text: copy.text().trim(), columnSpan: Number($(cell).attr('colspan')) || 1, rowSpan: Number($(cell).attr('rowspan')) || 1, heading: cell.tagName === 'th' };
      }).get();
      if (cells.length) rows.push(cells);
    });
    if (rows.length) tables.push({ rows });
  });
  return { tables, emptyUnverified: tables.length === 0 };
}
export function recoverLetterTitles(rows, html) {
  if (!Array.isArray(rows)) throw new Error('INVALID_RESPONSE');
  const $ = load(html || '');
  $('.hidden-lg').remove();
  const candidates = new Map();
  $('tr').each((_i, element) => {
    const row = $(element);
    const match = row.children('td').first().text().trim().match(/^#?\s*(\d+)$/);
    if (!match) return;
    const headings = row.next('tr').children('td').first().find('h4');
    if (headings.length !== 1) return;
    const id = Number(match[1]);
    const title = headings.text().trim();
    if (!Number.isSafeInteger(id) || !title) return;
    // Ambiguous duplicate IDs must not supply a title to another record.
    candidates.set(id, candidates.has(id) ? null : title);
  });
  let recoveredTitles = 0;
  const letters = rows.map(row => {
    if (!row || typeof row !== 'object') return row;
    if (typeof row.title === 'string' && row.title.trim()) return row;
    const title = candidates.get(row.id);
    if (!title) return row;
    recoveredTitles++;
    return { ...row, title };
  });
  return { letters, recoveredTitles };
}
export function normalizeLetters(rows) {
  if (!Array.isArray(rows) || rows.some(row => !row || typeof row !== 'object' || Array.isArray(row))) throw new Error('INVALID_RESPONSE');
  const diagnostics = { missingIds: 0, missingTitles: 0 };
  const letters = rows.map(row => {
    const id = Number.isSafeInteger(row.id) ? row.id : null;
    const title = typeof row.title === 'string' ? row.title : '';
    if (id === null) diagnostics.missingIds++;
    if (!title.trim()) diagnostics.missingTitles++;
    return {
      id, title,
      date: typeof row.date === 'string' ? row.date : null,
      status: ['read', 'unread'].includes(row.status) ? row.status : 'unknown',
      messageText: typeof row.messageText === 'string' ? row.messageText : null,
      classes: typeof row.classes === 'string' ? row.classes : null,
      incomplete: id === null || !title.trim()
    };
  });
  return { letters, diagnostics, needsReview: diagnostics.missingIds > 0 || diagnostics.missingTitles > 0 };
}
export function createPortal(makeClient = config => new ElternPortalApiClient(config)) {
  const username = process.env.ELTERNPORTAL_USER;
  const password = process.env.ELTERNPORTAL_PASSWORD;
  delete process.env.ELTERNPORTAL_USER;
  delete process.env.ELTERNPORTAL_PASSWORD;
  let queue = Promise.resolve();
  // Isolated sessions avoid child-context leakage between requests.
  async function execute(kind, args) {
    if (!username || !password) throw new Error('MISSING_SECRETS');
    const api = makeClient({ short: 'whgga', username, password, kidId: 0 });
    let letterHtml = '';
    let planText = '';
    api.client.defaults.timeout = 15000;
    api.client.defaults.maxRedirects = 5;
    api.client.interceptors.request?.use(assertReadRequest);
    api.client.defaults.beforeRedirect = options => {
      if (options.hostname !== 'whgga.eltern-portal.org' || options.protocol !== 'https:') throw new Error('REDIRECT_BLOCKED');
      if (/bestaetig/i.test(options.path || '')) throw new Error('REQUEST_BLOCKED');
    };
    api.client.interceptors.response.use(response => {
      if (typeof response.data === 'string' && response.config.url !== `${origin}/`) {
        if (load(response.data)('input[type="password"]').length) throw new Error('LOGIN_FAILED');
      }
      if (response.config.url.includes('/api/ws_get_termine.php') && response.data?.success !== 1) throw new Error('INVALID_RESPONSE');
      if (response.config.url === `${origin}/aktuelles/elternbriefe` && typeof response.data === 'string') letterHtml = response.data;
      if (/\/service\/(vertretungsplan|termine\/liste\/schulaufgaben)/.test(response.config.url) && typeof response.data === 'string') {
        const $ = load(response.data); $('script,style,.modal,input,textarea').remove();
        const content = $('#asam_content').length ? $('#asam_content') : $('.main_center');
        content.find('br').replaceWith('\n');
        planText = content.text().replace(/https?:\/\/\S+/g, '[URL ausgeblendet]').replace(/[ \t]+/g, ' ').replace(/\n\s*\n/g,'\n').trim().slice(0,12000);
      }
      // The library initializes with sentinel id=0, not an actual child ID.
      // Validate authentication below using getKids, as in the successful direct test.
      if (response.config.url.includes('/api/set_child.php')) {
        const childId = new URL(response.config.url).searchParams.get('id');
        if (childId !== '0' && String(response.data).trim() !== '1') throw new Error('CHILD_SELECTION_FAILED');
      }
      return response;
    });
    try {
      await api.init();
      const kids = await api.getKids();
      if (!kids.length || kids.some(k => !Number.isSafeInteger(k.id) || !k.firstName)) throw new Error('LOGIN_OR_PARSER_FAILED');
      if (kind === 'children') return { children: kids.map(({id, firstName, lastName, className}) => ({id, firstName, lastName, className})) };
      if (kind === 'events') {
        const from = args.from ? Date.parse(args.from) : Date.now();
        const to = args.to ? Date.parse(args.to) : from + 30 * 86400000;
        if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from || to - from > 90 * 86400000) throw new Error('INVALID_DATE_RANGE');
        const events = await api.getTermine(from, to);
        if (events.some(e => !Number.isFinite(e.startDate?.getTime()) || !Number.isFinite(e.endDate?.getTime()))) throw new Error('INVALID_RESPONSE');
        return { from: new Date(from).toISOString(), to: new Date(to).toISOString(), events: events.map(({id,title,startDate,endDate}) => ({id,title,startDate,endDate})) };
      }
      const kid = args.childId === undefined && kids.length === 1 ? kids[0] : kids.find(k => k.id === args.childId);
      if (!kid) throw new Error('CHILD_ID_REQUIRED_OR_INVALID');
      await api.setKid(kid.id);
      if (kind === 'exams') {
        const { data: html } = await api.client.get(`${origin}/service/termine/liste/schulaufgaben`);
        if(typeof html !== 'string') throw new Error('INVALID_RESPONSE');
        const parsed=parseExamPage(html);
        return { childId:kid.id, className:kid.className, source:'WHG Schulaufgabenplan', checkedAt:new Date().toISOString(), status:parsed.publishedEmpty?'no_published_entries':'available', ...parsed, emptyUnverified:false, note:parsed.publishedEmpty?'Die authentifizierte Schulaufgabenliste im Portal ist leer. Das bedeutet nicht, dass keine Pruefungen stattfinden; derzeit sind dort keine eingetragen.':'Originale Tabellenzeilen des Schulaufgabenplans. Bei Oberstufe persoenliche Kurszuordnung beachten.' };
      }
      if (kind === 'substitutions') return { childId:kid.id, ...await getDsbPlans(kid.className) };
      if (kind === 'letter' || kind === 'download') {
        const response = await api.client.get(`${origin}/aktuelles/elternbriefe`);
        const detail = letterDetails(response.data, args.letterId);
        if (kind === 'letter') return { ...detail, attachments: detail.attachments.map(({url,...item}) => item) };
        const attachment = detail.attachments.find(a => a.attachmentId === args.attachmentId);
        if (!attachment) throw new Error('ATTACHMENT_NOT_FOUND');
        const result = await api.client.get(attachment.url, { responseType: 'arraybuffer', maxContentLength: 30 * 1024 * 1024 });
        const bytes = Buffer.from(result.data);
        // Preserve arbitrary attachment bytes, but never mistake a login/error page for a file.
        if (/text\/html/i.test(result.headers?.['content-type'] || '') || /^\s*<(?:!doctype|html)/i.test(bytes.subarray(0,200).toString())) throw new Error('INVALID_RESPONSE');
        const extension = bytes.subarray(0,5).toString() === '%PDF-' ? '.pdf' : '.bin';
        const hash = createHash('sha256').update(bytes).digest('hex');
        const directory = process.env.WHG_DOWNLOAD_DIR || fileURLToPath(new URL('../WHG-Anhaenge/', import.meta.url));
        await mkdir(directory, { recursive: true });
        const path = join(directory, `Brief-${args.letterId}-${args.attachmentId}-${hash.slice(0,12)}${extension}`);
        await writeFile(path, bytes);
        return { letterId: args.letterId, attachmentId: args.attachmentId, originalName: attachment.name, path, bytes: bytes.length, sha256: hash, receiptConfirmed: false };
      }
      if (kind === 'timetable') {
        const response = await api.client.get(`${origin}/service/stundenplan`);
        if (typeof response.data !== 'string') throw new Error('INVALID_RESPONSE');
        return { childId: kid.id, className: kid.className, ...parseTimetable(response.data), note: 'Originale Tabellenstruktur mit Zeilen-/Spalten-Spannen. Leere oder verbundene Zellen nicht als Unterrichtsausfall interpretieren. Vertretungen sind nicht enthalten.' };
      }
      const rawLetters = await api.getElternbriefe();
      const recovered = recoverLetterTitles(rawLetters, letterHtml);
      const { letters, diagnostics, needsReview } = normalizeLetters(recovered.letters);
      diagnostics.recoveredTitles = recovered.recoveredTitles;
      return { childId: kid.id, total: letters.length, emptyUnverified: letters.length === 0, needsReview, diagnostics, letters: letters.slice(args.offset, args.offset + args.limit) };
    } finally {
      letterHtml = '';
      api.username = ''; api.password = '';
      await api.jar.removeAllCookies();
    }
  }
  return (kind, args = {}) => {
    const job = queue.then(() => execute(kind, args));
    queue = job.catch(() => {});
    return job;
  };
}
