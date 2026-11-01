/** 词汇表解析与文本解码，规则与 Android 版 VocabMarkdownParser / TextFiles 保持一致。 */

const SEPARATOR = /^:?-{2,}:?$/;
const NUMERIC = /^\d+[.、]?$/;

function cleanCell(cell) {
  let s = String(cell).trim();
  if (s.length >= 4 && s.startsWith('**') && s.endsWith('**')) s = s.slice(2, -2).trim();
  if (s.length >= 2 && s.startsWith('`') && s.endsWith('`')) s = s.slice(1, -1).trim();
  return s;
}

function isHeader(cells) {
  const joined = cells.join('');
  return joined.includes('英文') && (joined.includes('汉语') || joined.includes('中文'));
}

function isValidWord(word) {
  return Boolean(word) && /\p{L}/u.test(word) && !word.includes('|');
}

/**
 * 解析 Markdown 词汇表：三列或四列（首列序号会被忽略）。
 * 去重按英文小写，保留首次出现的顺序。
 * @returns {{word: string, pos: string, meaning: string}[]}
 */
export function parseMarkdown(markdown) {
  const out = new Map();
  for (const rawLine of String(markdown).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.includes('|')) continue;
    const cells = line.replace(/^\|/, '').replace(/\|$/, '').split('|').map(cleanCell);
    if (cells.length === 0) continue;
    if (cells.every((c) => c === '')) continue;
    if (cells.every((c) => SEPARATOR.test(c))) continue;
    if (isHeader(cells)) continue;

    const body = NUMERIC.test(cells[0] || '') ? cells.slice(1) : cells;
    let word;
    let pos;
    let meaning;
    if (body.length >= 3) {
      [word, pos, meaning] = body;
    } else if (body.length === 2) {
      word = body[0];
      pos = '';
      meaning = body[1];
    } else {
      continue;
    }
    if (!isValidWord(word) || !meaning) continue;
    const key = word.toLowerCase();
    if (out.has(key)) continue;
    out.set(key, { word: word.trim(), pos: (pos || '').trim(), meaning: meaning.trim() });
  }
  return [...out.values()];
}

/** 自动识别 UTF-8（含 BOM）/ UTF-16 / GB18030。 */
export function decodeText(bytes) {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(buf.subarray(3));
  }
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(buf.subarray(2));
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(buf.subarray(2));
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder('gb18030').decode(buf);
  }
}
