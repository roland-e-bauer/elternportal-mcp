import { load } from 'cheerio';

export function parseExamPage(html) {
  const $ = load(html);
  if ($('input[type=password]').length) throw new Error('LOGIN_FAILED');
  const table = $('#asam_content table.termine-table');
  const label = $('#asam_content a').filter((_i,a) => /Schulaufgabenplan/.test($(a).text())).first().text().trim();
  if (table.length !== 1 || !label) throw new Error('EXAM_LAYOUT_UNRECOGNIZED');
  const rows = [];
  table.find('tr').each((_i,tr) => {
    const cells = $(tr).children('td,th').map((_j,cell) => {
      const clone=$(cell).clone();clone.find('br').replaceWith('\n');return clone.text().trim();
    }).get();
    if(cells.some(Boolean)) rows.push(cells);
  });
  // Keep original columns: exam formats vary by school and may include monthly headings.
  return { label, rows, publishedEmpty: rows.length === 0 };
}
