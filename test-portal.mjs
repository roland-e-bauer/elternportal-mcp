import { ElternPortalApiClient } from '@philippdormann/elternportal-api';
import { load } from 'cheerio';
import { writeFileSync } from 'node:fs';

const report = { school: 'whgga', version: '2.11.0', checkedAt: new Date().toISOString(), steps: [] };
let stage = 'Umgebungsvariablen';
let client;
// Never print exception objects: HTTP errors can contain credentials and cookies.
const deadline = setTimeout(() => {
  report.steps.push({ step: stage, status: 'TIMEOUT' });
  finish(1);
}, 120_000);
function finish(code) {
  clearTimeout(deadline);
  console.log(JSON.stringify(report, null, 2));
  writeFileSync(new URL('./test-status.json', import.meta.url), JSON.stringify(report, null, 2));
  process.exit(code);
}
try {
  const username = process.env.ELTERNPORTAL_USER;
  const password = process.env.ELTERNPORTAL_PASSWORD;
  if (!username || !password) throw new Error('MISSING_SECRETS');
  client = new ElternPortalApiClient({ short: 'whgga', username, password, kidId: 0 });
  delete process.env.ELTERNPORTAL_USER;
  delete process.env.ELTERNPORTAL_PASSWORD;
  client.client.defaults.timeout = 20_000;
  // Follow redirects only within the intended school origin, including login redirects.
  client.client.defaults.maxRedirects = 5;
  client.client.defaults.beforeRedirect = options => {
    if (options.hostname !== 'whgga.eltern-portal.org' || options.protocol !== 'https:') {
      throw new Error('UNEXPECTED_REDIRECT');
    }
  };
  client.client.interceptors.response.use(response => {
    if (typeof response.data === 'string' && response.config.url !== 'https://whgga.eltern-portal.org/') {
      const $ = load(response.data);
      if ($('input[type="password"]').length) throw new Error('LOGIN_NOT_CONFIRMED');
    }
    if (response.config.url.includes('/api/ws_get_termine.php') && response.data?.success !== 1) {
      throw new Error('CALENDAR_RESPONSE_INVALID');
    }
    return response;
  });
  stage = 'Login';
  await client.init();
  // init() itself does not validate successful authentication in this library.
  const home = await client.client.get('https://whgga.eltern-portal.org/start');
  const $ = load(home.data);
  if (!$('a[href*="logout"], form[action*="logout"], select.form-control option').length) {
    throw new Error('LOGIN_NOT_CONFIRMED');
  }
  report.steps.push({ step: stage, status: 'OK' });
  stage = 'Kinder';
  const kids = await client.getKids();
  if (!kids.length || kids.some(k => !Number.isFinite(k.id) || !k.firstName)) {
    throw new Error('KIDS_NOT_CONFIRMED');
  }
  report.steps.push({ step: stage, status: 'OK', count: kids.length });
  stage = 'Termine';
  const from = Date.now();
  const events = await client.getTermine(from, from + 90 * 86400_000);
  if (!Array.isArray(events)) throw new Error('CALENDAR_RESPONSE_INVALID');
  report.steps.push({ step: stage, status: 'OK', count: events.length, days: 90 });
  stage = 'Elternbriefe';
  const letters = await client.getElternbriefe();
  if (!Array.isArray(letters)) throw new Error('LETTERS_RESPONSE_INVALID');
  report.steps.push({ step: stage, status: letters.length ? 'OK' : 'EMPTY_UNVERIFIED', count: letters.length });
  // Empty scraped HTML alone cannot prove the parser still matches the portal.
  finish(letters.length ? 0 : 2);
} catch (error) {
  const allowed = new Set(['MISSING_SECRETS', 'LOGIN_NOT_CONFIRMED', 'KIDS_NOT_CONFIRMED', 'CALENDAR_RESPONSE_INVALID', 'LETTERS_RESPONSE_INVALID', 'UNEXPECTED_REDIRECT']);
  report.steps.push({ step: stage, status: 'FAILED', reason: allowed.has(error?.message) ? error.message : 'REQUEST_OR_PARSER_FAILED', ...(Number.isInteger(error?.response?.status) ? { httpStatus: error.response.status } : {}) });
  finish(1);
}
