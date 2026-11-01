/** 测试脚本共用：起本地静态服务 + 用本机 Edge 开浏览器。 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

export const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];

export function edgePath() {
  const found = EDGE_CANDIDATES.find((file) => fs.existsSync(file));
  if (!found) throw new Error('没找到 Edge，请把 EDGE 路径填到 scripts/lib.js');
  return found;
}

/** 启动 server.js，返回 { base, stop }；端口由服务自己挑，从输出里读。 */
export function startServer(extraArgs = []) {
  const child = spawn(process.execPath, ['server.js', '--no-open', '--no-pid', ...extraArgs], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  return new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`服务启动超时：\n${output}`)), 25000);
    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
      const match = output.match(/已启动：(http:\/\/[^\s]+)/);
      if (match) {
        clearTimeout(timer);
        resolve({
          base: match[1],
          child,
          stop() {
            child.kill();
          },
        });
      }
    });
    child.stderr.on('data', (chunk) => { output += chunk.toString(); });
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`服务提前退出（${code}）：\n${output}`));
    });
  });
}

export async function launchBrowser() {
  return chromium.launch({ executablePath: edgePath(), headless: true });
}

export function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}
