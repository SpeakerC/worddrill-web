/**
 * 本地静态服务器（只用于本机预览 / 离线缓存调试）。
 *
 * 正式使用不需要它：把 public/ 放到任意静态托管（GitHub Pages 等）就能打开，
 * 数据存在浏览器里。这里只负责把文件发出去，没有任何接口。
 *
 *   node server.js                # http://127.0.0.1:3120
 *   node server.js --port=3130    # 换端口（占用会自动 +1）
 *   node server.js --lan          # 允许手机在同一 Wi-Fi 下访问
 *   node server.js --no-open      # 不自动开浏览器
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { exec } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const PID_FILE = path.join(DATA_DIR, 'server.pid');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};

function notFound(res) {
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('页面不存在');
}

function serveFile(res, file) {
  fs.readFile(file, (err, data) => {
    if (err) {
      notFound(res);
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': data.length,
      'Cache-Control': 'no-cache',
      // Service Worker 需要拿到最新文件，别让浏览器自己缓存太久
      'Service-Worker-Allowed': '/',
    });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('方法不被允许');
    return;
  }
  let pathname = '/';
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
  } catch {
    notFound(res);
    return;
  }
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const file = path.resolve(PUBLIC_DIR, rel);
  if (file !== PUBLIC_DIR && !file.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('禁止访问');
    return;
  }
  serveFile(res, file);
});

function openBrowser(url) {
  const cmd = process.platform === 'win32'
    ? `start "" "${url}"`
    : process.platform === 'darwin'
      ? `open "${url}"`
      : `xdg-open "${url}"`;
  exec(cmd, () => {});
}

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const item of list || []) {
      if (item.family === 'IPv4' && !item.internal) out.push(item.address);
    }
  }
  return out;
}

const args = process.argv.slice(2);
const noOpen = args.includes('--no-open') || process.env.WORDDRILL_NO_OPEN === '1';
const lan = args.includes('--lan') || process.env.WORDDRILL_LAN === '1';
const noPid = args.includes('--no-pid') || process.env.WORDDRILL_NO_PID === '1';
const wantedPort = Number((args.find((a) => a.startsWith('--port=')) || '').split('=')[1]) || 3120;
const host = lan ? '0.0.0.0' : '127.0.0.1';

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
    if (!noPid) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(PID_FILE, String(process.pid), 'utf8');
    }
    const url = `http://${lan ? '127.0.0.1' : host}:${server.address().port}/`;
    console.log(`单词练习已启动：${url}`);
    if (lan) {
      for (const address of lanAddresses()) {
        console.log(`手机同一 Wi-Fi 打开：http://${address}:${server.address().port}/`);
      }
    }
    console.log('数据保存在浏览器本地，直接关闭窗口即可，按 Ctrl+C 停止服务。');
    if (!noOpen) openBrowser(url);
  });
}

function cleanup() {
  if (noPid) return;
  try {
    fs.rmSync(PID_FILE, { force: true });
  } catch {
    /* 忽略 */
  }
}

server.on('close', cleanup);
process.on('SIGINT', () => server.close(() => process.exit(0)));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('exit', cleanup);

listen(wantedPort);
