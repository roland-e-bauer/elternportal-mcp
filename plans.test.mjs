import test from 'node:test';
import assert from 'node:assert/strict';
import {parseExamPage} from './plans.mjs';
import {parseDsbPage,matchesClass,validDsbUrl} from './dsb.mjs';
test('DSB uses explicit headers, class token matching and preserves daily notices',()=>{
 const html='<div class="mon_title">24.9.2026 Donnerstag</div><table class="mon_head"><tr><td>Stand: 23.09.2026 13:37</td></tr></table><table class="info"><tr><td>TUM Englisch: 7./8. Stunde</td></tr></table><table class="mon_list"><tr><th>Klasse(n)</th><th>Stunde</th><th>Vertreter</th><th>Fach</th><th>Raum</th><th>Text</th></tr><tr><td>12, 13</td><td>7 - 8</td><td>A?B</td><td>Englisch</td><td>A160</td><td>Hinweis</td></tr><tr><td>112</td><td>1</td><td>C</td><td>M</td><td>X</td><td></td></tr></table>';
 const p=parseDsbPage(html,'12','fallback');
 assert.equal(p.date,'2026-09-24');assert.equal(p.entries.length,1);assert.equal(p.entries[0]['Stunde'],'7 - 8');
 assert.equal(p.lastUpdated,'23.09.2026 13:37');assert.equal(p.totalEntriesOnPage,2);assert.match(p.notices[0],/TUM/);
 assert.equal(parseDsbPage(html,'11','fallback').entries.length,0);
 assert.equal(matchesClass('05A, 05B','5a'),true);assert.equal(matchesClass('112','12'),false);
 assert.throws(()=>parseDsbPage('<html>Login</html>','12',''),/DSB_LAYOUT_UNRECOGNIZED/);
 assert.throws(()=>parseDsbPage(html.replace('<th>Klasse(n)</th>','<th>Anders</th>'),'12',''),/DSB_LAYOUT_UNRECOGNIZED/);
 for(const url of ['http://light.dsbcontrol.de/a','https://evil.invalid/a','https://light.dsbcontrol.de.evil.invalid/a','https://user:pass@light.dsbcontrol.de/a'])assert.throws(()=>validDsbUrl(url),/DSB_URL_BLOCKED/);
 assert.equal(validDsbUrl('https://light.dsbcontrol.de/a.htm').hostname,'light.dsbcontrol.de');
});
test('exam page distinguishes published empty list from absent/wrong markup',()=>{
 const wrap=rows=>`<div id="asam_content"><a>Schulaufgabenplan (12)</a><table class="termine-table">${rows}</table></div>`;
 assert.equal(parseExamPage(wrap('')).publishedEmpty,true);
 const data=parseExamPage(wrap('<tr><td>12.10.2026</td><td>Mathematik<br>2M1</td></tr>'));
 assert.equal(data.publishedEmpty,false);assert.equal(data.rows[0][1],'Mathematik\n2M1');
 assert.throws(()=>parseExamPage('<div id="asam_content"></div>'),/EXAM_LAYOUT_UNRECOGNIZED/);
 assert.throws(()=>parseExamPage('<input type="password">'),/LOGIN_FAILED/);
});
