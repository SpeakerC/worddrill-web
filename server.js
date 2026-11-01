'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { exec } = require('node:child_process');

const { Store } = require('./lib/db');
const { parseMarkdown, decodeText } = require('./lib/vocab');
const { buildItems, MODES } = require('./lib/quiz');
const { loadAbout } = require('./lib/about');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = process.env.WORDDRILL_DATA || path.join(ROOT, 'data');
const SEED_FILE = path.join(ROOT, 'assets', 'words3500.json');
const ABOUT_FILE = path.join(ROOT, 'assets', 'about.txt');
const VERSION = '1.0.0';
const MAX_BODY = 16 * 1024 * 1024;
const MAX_IMPORT_BYTES = 4 * 1024 * 1024;

const store = new Store({ dataDir: DATA_DIR, seedFile: SEED_FILE }).load();
const about = loadAbout(ABOUT_FILE, { name: '单词练习', version: VERSION });

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function fail(res, status, message) {
  json(res, status, { error: message });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error('请求太大'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('请求格式错误'));
      }
    });
    req.on('error', reject);
  });
}

function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.replace(/^\/+/, ''));
  const file = path.resolve(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR + path.sep) && file !== path.join(PUBLIC_DIR, 'index.html')) {
    fail(res, 403, '禁止访问');
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      fail(res, 404, '页面不存在');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': data.length,
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
}

function parseIntOr(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

async function handleApi(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean); // ['api', 'books', '1', 'words']
  const method = req.method || 'GET';

  if (method === 'GET' && url.pathname === '/api/bootstrap') {
    json(res, 200, { books: store.books(), about, modes: MODES, version: VERSION });
    return;
  }
  if (method === 'GET' && url.pathname === '/api/about') {
    json(res, 200, about);
    return;
  }

  if (parts[1] === 'books' && parts[2] && parts[3] === 'stats' && method === 'GET') {
    const book = store.book(Number(parts[2]));
    if (!book) return fail(res, 404, '词库不存在');
    json(res, 200, { ...book, ...store.stats(book.id) });
    return;
  }

  if (parts[1] === 'books' && parts[2] && parts[3] === 'words' && method === 'GET') {
    const bookId = Number(parts[2]);
    const filter = url.searchParams.get('filter') || 'all';
    const q = url.searchParams.get('q') || '';
    json(res, 200, { words: store.words(bookId, filter, q) });
    return;
  }

  if (parts[1] === 'books' && parts[2] && parts[3] === 'mistakes' && method === 'GET') {
    const bookId = Number(parts[2]);
    const items = store.mistakes(bookId);
    json(res, 200, {
      words: items.map((item) => item.word),
      counts: Object.fromEntries(items.map((item) => [item.word.id, item.wrong])),
    });
    return;
  }

  if (parts[1] === 'books' && parts[2] && parts[3] === 'unblock-all' && method === 'POST') {
    const bookId = Number(parts[2]);
    json(res, 200, { changed: store.unblockAll(bookId) });
    return;
  }

  if (parts[1] === 'books' && parts[2] && parts[3] === 'clear-mistakes' && method === 'POST') {
    store.clearMistakes(Number(parts[2]));
    json(res, 200, { ok: true });
    return;
  }

  if (parts[1] === 'books' && parts[2] && parts.length === 3 && method === 'DELETE') {
    const bookId = Number(parts[2]);
    if (!store.deleteBook(bookId)) return fail(res, 400, '内置词库不能删除');
    json(res, 200, { ok: true });
    return;
  }

  if (parts[1] === 'books' && parts[2] && parts[3] === 'import' && method === 'POST') {
    const body = await readBody(req);
    const entries = Array.isArray(body.entries) ? body.entries : [];
    const result = store.importEntries(Number(parts[2]), null, entries);
    json(res, 200, result);
    return;
  }

  if (url.pathname === '/api/books' && method === 'POST') {
    const body = await readBody(req);
    const entries = Array.isArray(body.entries) ? body.entries : [];
    if (entries.length === 0) return fail(res, 400, '没有可导入的单词');
    const name = String(body.name || '').trim();
    if (!name) return fail(res, 400, '请填写词库名称');
    const result = store.importEntries(null, name, entries);
    json(res, 200, result);
    return;
  }

  if (parts[1] === 'words' && parts[2] && parts[3] === 'star' && method === 'POST') {
    const body = await readBody(req);
    const ok = store.setStar(Number(parts[2]), Boolean(body.starred));
    json(res, ok ? 200 : 404, { ok });
    return;
  }

  if (parts[1] === 'words' && parts[2] && parts[3] === 'block' && method === 'POST') {
    const body = await readBody(req);
    const ok = store.setBlocked(Number(parts[2]), Boolean(body.blocked));
    json(res, ok ? 200 : 404, { ok });
    return;
  }

  if (url.pathname === '/api/practice/start' && method === 'POST') {
    const body = await readBody(req);
    const mode = MODES[body.mode] ? body.mode : 'en_zh';
    const book = store.book(Number(body.bookId));
    if (!book) return fail(res, 404, '词库不存在');
    const count = Math.min(Math.max(parseIntOr(body.count, 20), 1), 200);
    const start = parseIntOr(body.start, 1);
    const end = parseIntOr(body.end, Number.MAX_SAFE_INTEGER);
    const filter = ['all', 'starred', 'mistakes'].includes(body.filter) ? body.filter : 'all';
    const allowRepeat = body.allowRepeat !== false;
    const ids = Array.isArray(body.wordIds) ? body.wordIds.map(Number) : [];
    const words = ids.length > 0
      ? store.wordsByIds(ids)
      : store.pickWords(book.id, { start, end, count, allowRepeat, filter });
    const requested = ids.length > 0 ? ids.length : count;
    const items = buildItems(words, store.allWords(), requested, mode);
    json(res, 200, { items, requested, mode, bookName: book.name });
    return;
  }

  if (url.pathname === '/api/practice/answer' && method === 'POST') {
    const body = await readBody(req);
    const wordId = Number(body.wordId);
    const mode = MODES[body.mode] ? body.mode : 'en_zh';
    if (!wordId) return fail(res, 400, '缺少单词');
    store.recordAnswer(wordId, mode, Boolean(body.correct));
    json(res, 200, { ok: true });
    return;
  }

  if (url.pathname === '/api/practice/clear-log' && method === 'POST') {
    store.clearPracticeLog();
    json(res, 200, { ok: true });
    return;
  }

  if (url.pathname === '/api/parse' && method === 'POST') {
    const body = await readBody(req);
    const base64 = String(body.base64 || '');
    if (!base64) return fail(res, 400, '没有收到文件内容');
    const bytes = Buffer.from(base64, 'base64');
    if (bytes.length > MAX_IMPORT_BYTES) return fail(res, 400, '文件超过 4 MB，请拆分后再导入');
    if (bytes.length === 0) return fail(res, 400, '文件是空的');
    let text;
    try {
      text = decodeText(bytes);
    } catch {
      return fail(res, 400, '无法识别文件编码');
    }
    const entries = parseMarkdown(text);
    json(res, 200, { entries, total: entries.length });
    return;
  }

  fail(res, 404, '接口不存在');
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  try {
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      fail(res, 405, '方法不被允许');
      return;
    }
    serveStatic(req, res, url.pathname);
  } catch (err) {
    console.error(err);
    fail(res, 500, err.message || '服务器错误');
  }
});

function openBrowser(url) {
  const cmd = process.platform === 'win32'
    ? `start "" "${url}"`
    : process.platform === 'darwin'
      ? `open "${url}"`
      : `xdg-open "${url}"`;
  exec(cmd, () => {});
}

const args = process.argv.slice(2);
const noOpen = args.includes('--no-open') || process.env.WORDDRILL_NO_OPEN === '1';
const wantedPort = Number((args.find((a) => a.startsWith('--port=')) || '').split('=')[1]) || 3120;
const host = '127.0.0.1';

function listen(port, attempt = 0) {
  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE' && attempt < 20) {
      listen(port + 1, attempt + 1);
      return;
    }
    console.error('启动失败：', err.message);
    process.exit(1);
  });
  server.listen(port, host, () => {
    const url = `http://${host}:${port}/`;
    fs.writeFileSync(path.join(DATA_DIR, 'server.pid'), String(process.pid), 'utf8');
    console.log(`单词练习 Web 版已启动：${url}`);
    console.log(`数据文件：${path.join(DATA_DIR, 'db.json')}`);
    console.log('按 Ctrl+C 停止。');
    if (!noOpen) openBrowser(url);
  });
}

function shutdown() {
  try {
    fs.rmSync(path.join(DATA_DIR, 'server.pid'), { force: true });
  } catch {
    /* 忽略 */
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 800).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('exit', () => {
  try {
    fs.rmSync(path.join(DATA_DIR, 'server.pid'), { force: true });
  } catch {
    /* 忽略 */
  }
});

listen(wantedPort);
