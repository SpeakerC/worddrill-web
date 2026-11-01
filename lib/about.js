'use strict';

const fs = require('node:fs');

/**
 * 解析 about.txt（字段 = 内容，缩进行接到上一条），规则与 Android 版 AboutConfig 一致。
 * 缺字段时：名称/版本用默认值，其余不显示。
 */
function parseAbout(text, fallback = {}) {
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

function loadAbout(file, fallback) {
  try {
    return parseAbout(fs.readFileSync(file, 'utf8'), fallback);
  } catch {
    return { ...fallback, developer: '', summary: '', rows: [], note: '' };
  }
}

module.exports = { parseAbout, loadAbout };
