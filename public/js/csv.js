/**
 * 错题导出 CSV，纯函数，浏览器与 Node 共用。
 *
 * 两种版本：
 *   复习版 英文,词性,中文释义,复习提示——英汉对照，用来过一遍；
 *   练习版 只留一列，可以选择留英文（看英文自己回忆中文）或留中文（看中文拼写英文）。
 *
 * 数据里没有音标和例句，所以不编造；复习提示写的是真实练过次数与答错次数。
 */

/** CSV 单元格转义：含逗号、引号、换行时加引号，内部引号翻倍。 */
function cell(value) {
  const text = String(value == null ? '' : value);
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function row(cells) {
  return cells.map(cell).join(',');
}

/**
 * 生成错题 CSV 文本。
 * @param {Array<{word:{word:string,pos:string,meaning:string}, wrong?:number, streak?:number}>} items
 * @param {{kind?:'review'|'practice', keep?:'en'|'zh'}} opts
 */
export function mistakesCsv(items, opts = {}) {
  const kind = opts.kind === 'practice' ? 'practice' : 'review';
  const keep = opts.keep === 'zh' ? 'zh' : 'en';
  const list = Array.isArray(items) ? items : [];
  const lines = [];

  if (kind === 'review') {
    lines.push(row(['英文', '词性', '中文释义', '复习提示']));
    for (const item of list) {
      const w = item.word || {};
      const note = [];
      if (item.wrong) note.push(`错 ${item.wrong} 次`);
      if (item.streak) note.push(`已连对 ${item.streak} 次`);
      lines.push(row([w.word || '', w.pos || '', w.meaning || '', note.join('，')]));
    }
    return lines.join('\r\n');
  }

  // 练习版：单列
  const header = keep === 'zh' ? '中文释义' : '英文';
  lines.push(row([header]));
  for (const item of list) {
    const w = item.word || {};
    const value = keep === 'zh' ? (w.meaning || '') : (w.word || '');
    if (value) lines.push(row([value]));
  }
  return lines.join('\r\n');
}

/**
 * 给 Excel 用的 BOM。不加 BOM 的话 Windows 版 Excel 会把 UTF-8 中文读成乱码。
 */
export const CSV_BOM = '\uFEFF';

/** 导出文件名：错题-复习版-20261108.csv */
export function csvFileName(kind, keep, date = new Date()) {
  const stamp = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
  const label = kind === 'practice'
    ? (keep === 'zh' ? '练习版-中文' : '练习版-英文')
    : '复习版';
  return `错题-${label}-${stamp}.csv`;
}
