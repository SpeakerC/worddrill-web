/**
 * 解析 about.txt（字段 = 内容，缩进行接到上一条），规则与 Android 版 AboutConfig 一致。
 * 缺字段时：名称/版本用默认值，其余不显示。
 */
export function parseAbout(text, fallback = {}) {
  const pairs = [];
  const lines = String(text).replace(/^\uFEFF/, '').split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) continue;
    const indented = /^[ \t]/.test(raw);
    if (indented && pairs.length > 0) {
      const last = pairs[pairs.length - 1];
      last.value = last.value ? `${last.value}\n${line}` : line;
      continue;
    }
    const idx = line.search(/[=:：]/);
    if (idx <= 0) continue;
    pairs.push({ key: line.slice(0, idx).trim(), value: line.slice(idx + 1).trim() });
  }

  const map = new Map();
  const rows = [];
  for (const { key, value } of pairs) {
    if (key === '信息' || key === '资料' || key === '信息行') {
      const cut = value.indexOf('|');
      rows.push(cut < 0
        ? { label: '', value: value.trim() }
        : { label: value.slice(0, cut).trim(), value: value.slice(cut + 1).trim() });
    } else {
      map.set(key, value);
    }
  }

  const name = map.get('名称') || fallback.name || '';
  const version = map.get('版本') || fallback.version || '';
  return {
    name,
    version,
    developer: (map.get('开发者') || '').trim(),
    summary: (map.get('简介') || '').trim(),
    rows: rows.filter((row) => row.label || row.value),
    note: (map.get('备注') || '').trim(),
  };
}

const HTML_ESCAPES = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
};

export function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
}

/*
 * 关于页的文本里可以放链接，两种写法都认：
 *   [开放源代码许可](https://example.com/LICENSE)
 *   <a href="https://example.com/LICENSE">开放源代码许可</a>
 * 只允许 http/https，其余内容一律转义，避免把配置写成的 HTML 当代码执行。
 */
const LINK = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|<a\s+[^>]*href="(https?:\/\/[^"]+)"[^>]*>([^<]*)<\/a>/gi;

export function richText(text) {
  const source = String(text == null ? '' : text);
  let out = '';
  let last = 0;
  for (const match of source.matchAll(LINK)) {
    out += escapeHtml(source.slice(last, match.index));
    const label = match[1] ?? match[4];
    const url = match[2] ?? match[3];
    out += `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`;
    last = match.index + match[0].length;
  }
  out += escapeHtml(source.slice(last));
  return out;
}
