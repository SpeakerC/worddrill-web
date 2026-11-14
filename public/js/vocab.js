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

/** 例句列：英文||中文（也接受只有英文）。 */
function parseExample(raw) {
  const text = cleanCell(raw);
  if (!text) return { exampleEn: '', exampleZh: '' };
  const at = text.indexOf('||');
  return at < 0
    ? { exampleEn: text, exampleZh: '' }
    : { exampleEn: text.slice(0, at).trim(), exampleZh: text.slice(at + 2).trim() };
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
    // 例句用「英文||中文」分隔，竖线本身会打断表格；先换成占位符再拆列。
    const safeLine = line.replace(/\|\|/g, '\u0001');
    const cells = safeLine.replace(/^\|/, '').replace(/\|$/, '').split('|')
      .map((cell) => cleanCell(cell).replace(/\u0001/g, '||'));
    if (cells.length === 0) continue;
    if (cells.every((c) => c === '')) continue;
    if (cells.every((c) => SEPARATOR.test(c))) continue;
    if (isHeader(cells)) continue;

    const body = NUMERIC.test(cells[0] || '') ? cells.slice(1) : cells;
    let word;
    let pos;
    let meaning;
    let example = { exampleEn: '', exampleZh: '' };
    if (body.length >= 4) {
      [word, pos, meaning] = body;
      example = parseExample(body[3]);
    } else if (body.length === 3) {
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
    const entry = {
      word: word.trim(),
      pos: (pos || '').trim(),
      meaning: meaning.trim(),
    };
    if (example.exampleEn) entry.exampleEn = example.exampleEn;
    if (example.exampleZh) entry.exampleZh = example.exampleZh;
    out.set(key, entry);
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
