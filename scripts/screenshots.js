'use strict';

/**
 * 用本机 Edge（无头）真实渲染各页面，输出到 docs/screenshots/。
 *   node scripts/screenshots.js
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'docs', 'screenshots');
const PORT = Number(process.env.SHOT_PORT || 3198);
const BASE = `http://127.0.0.1:${PORT}/`;
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

function waitReady(child) {
  return new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`服务启动超时：\n${output}`)), 25000);
    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
      if (output.includes('已启动')) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.stderr.on('data', (chunk) => { output += chunk.toString(); });
  });
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'worddrill-shot-'));
  const child = spawn(process.execPath, ['server.js', '--no-open', `--port=${PORT}`], {
    cwd: ROOT,
    env: { ...process.env, WORDDRILL_DATA: dataDir },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const browser = await chromium.launch({ executablePath: EDGE, headless: true });
  try {
    await waitReady(child);
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1.5 });
    page.on('pageerror', (err) => console.error('页面脚本错误：', err.message));

    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForSelector('.hero');
    await page.fill('#countInput', '8');
    await page.screenshot({ path: path.join(OUT, 'home.png'), fullPage: true });

    await page.click('[data-action="start"]');
    await page.waitForSelector('.prompt');
    await page.screenshot({ path: path.join(OUT, 'practice.png'), fullPage: true });

    await page.click('.opt');
    await page.waitForSelector('.feedback');
    await page.screenshot({ path: path.join(OUT, 'practice_feedback.png'), fullPage: true });

    let rounds = 0;
    for (let i = 0; i < 60; i += 1) {
      if (await page.$('.score')) break;
      const next = await page.$('[data-action="next"]');
      if (next) {
        await next.click();
      } else {
        const opt = await page.$('.opt:not([disabled])');
        if (!opt) {
          await page.waitForTimeout(200);
          continue;
        }
        await opt.click();
        await page.waitForSelector('.feedback');
        rounds += 1;
      }
      await page.waitForTimeout(260);
    }
    if (!(await page.$('.score'))) {
      console.error(`练习未结束（答了 ${rounds} 题，当前 ${page.url()}）`);
      console.error((await page.textContent('body')).replace(/\s+/g, ' ').slice(0, 300));
    }
    await page.waitForSelector('.score');
    await page.screenshot({ path: path.join(OUT, 'result.png'), fullPage: true });

    /* 自组词库 + 屏蔽，用于词表截图 */
    const bookId = await page.evaluate(async () => {
      const entries = [
        { word: 'competence', pos: 'n.', meaning: '能力；胜任' },
        { word: 'tricky', pos: 'adj.', meaning: '难对付的，棘手的' },
        { word: 'mindset', pos: 'n.', meaning: '思维模式；心态' },
        { word: 'overcome', pos: 'v.', meaning: '克服；战胜' },
        { word: 'patient', pos: 'adj.', meaning: '有耐心的' },
        { word: 'achieve', pos: 'v.', meaning: '实现；达到' },
      ];
      const res = await fetch('/api/books', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '必修一 Unit 3', entries }),
      });
      const data = await res.json();
      localStorage.setItem('worddrill.bookId', String(data.bookId));
      const list = await (await fetch(`/api/books/${data.bookId}/words?filter=all`)).json();
      await fetch(`/api/words/${list.words[2].id}/block`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blocked: true }),
      });
      return data.bookId;
    });

    await page.goto(`${BASE}#/list`, { waitUntil: 'networkidle' });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('.word-row');
    await page.screenshot({ path: path.join(OUT, 'word_list.png'), fullPage: true });

    await page.click('[data-action="show-blocked"]');
    await page.waitForSelector('.word-row');
    await page.screenshot({ path: path.join(OUT, 'blocked_words.png'), fullPage: true });

    await page.goto(`${BASE}#/import`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.drop');
    await page.fill('#nameInput', '必修一 Unit 3');
    await page.fill('#markdownInput', [
      '| # | 英文 | 词性 | 汉语 |',
      '|---|---|---|---|',
      '| 1 | competence | n. | 能力；胜任 |',
      '| 2 | tricky | adj. | 难对付的，棘手的 |',
      '| 3 | mindset | n. | 思维模式；心态 |',
    ].join('\n'));
    await page.click('[data-action="preview"]');
    await page.waitForSelector('#preview:not([hidden])');
    await page.screenshot({ path: path.join(OUT, 'import.png'), fullPage: true });

    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForSelector('.hero');
    await page.click('[data-action="about"]');
    await page.waitForSelector('.about-card');
    await page.screenshot({ path: path.join(OUT, 'about.png') });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    await page.goto(`${BASE}#/books`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.word-row');
    await page.screenshot({ path: path.join(OUT, 'books.png'), fullPage: true });

    console.log(`✔ 截图完成：${bookId}，输出 ${OUT}`);
  } finally {
    await browser.close();
    child.kill();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('✖ 截图失败：', err);
  process.exit(1);
});
