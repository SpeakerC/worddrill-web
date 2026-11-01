/**
 * 用本机 Edge（无头）真实渲染各页面，输出到 docs/screenshots/。
 *   node scripts/screenshots.js
 */
import fs from 'node:fs';
import path from 'node:path';

import { ROOT, launchBrowser, startServer } from './lib.js';

const OUT = path.join(ROOT, 'docs', 'screenshots');

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const server = await startServer();
  const browser = await launchBrowser();

  try {
    /* ---------- 桌面端 ---------- */
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1.5 });
    const page = await context.newPage();
    page.on('pageerror', (err) => console.error('页面脚本错误：', err.message));

    await page.goto(server.base, { waitUntil: 'networkidle' });
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
    }
    await page.waitForSelector('.score');
    await page.screenshot({ path: path.join(OUT, 'result.png'), fullPage: true });

    /* 自组词库 + 屏蔽，用于词表截图 */
    const bookId = await page.evaluate(() => {
      const entries = [
        { word: 'competence', pos: 'n.', meaning: '能力；胜任' },
        { word: 'tricky', pos: 'adj.', meaning: '难对付的，棘手的' },
        { word: 'mindset', pos: 'n.', meaning: '思维模式；心态' },
        { word: 'overcome', pos: 'v.', meaning: '克服；战胜' },
        { word: 'patient', pos: 'adj.', meaning: '有耐心的' },
        { word: 'achieve', pos: 'v.', meaning: '实现；达到' },
      ];
      const result = window.worddrill.repo.createBook('必修一 Unit 3', entries);
      localStorage.setItem('worddrill.bookId', String(result.bookId));
      const list = window.worddrill.repo.listWords(result.bookId, 'all');
      window.worddrill.repo.setBlocked(list.words[2].id, true);
      return result.bookId;
    });

    await page.goto(`${server.base}#/list`, { waitUntil: 'networkidle' });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('.word-row');
    await page.screenshot({ path: path.join(OUT, 'word_list.png'), fullPage: true });

    await page.click('[data-action="show-blocked"]');
    await page.waitForSelector('.word-row');
    await page.screenshot({ path: path.join(OUT, 'blocked_words.png'), fullPage: true });

    await page.evaluate(() => { location.hash = '#/import'; });
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

    await page.evaluate(() => { location.hash = '#/'; });
    await page.waitForSelector('.hero');
    await page.click('[data-action="about"]');
    await page.waitForSelector('.about-card');
    await page.screenshot({ path: path.join(OUT, 'about.png') });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    await page.evaluate(() => { location.hash = '#/books'; });
    await page.waitForSelector('.word-row');
    await page.screenshot({ path: path.join(OUT, 'books.png'), fullPage: true });

    await context.close();

    /* ---------- 手机端 ---------- */
    const mobile = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    });
    const phone = await mobile.newPage();
    await phone.goto(server.base, { waitUntil: 'networkidle' });
    await phone.waitForSelector('.hero');
    await phone.screenshot({ path: path.join(OUT, 'mobile-home.png'), fullPage: true });

    await phone.click('[data-action="start"]');
    await phone.waitForSelector('.prompt');
    await phone.screenshot({ path: path.join(OUT, 'mobile-practice.png'), fullPage: true });

    await phone.evaluate(() => { location.hash = '#/list'; });
    await phone.waitForSelector('.word-row');
    await phone.screenshot({ path: path.join(OUT, 'mobile-list.png') });
    await mobile.close();

    console.log(`✔ 截图完成：${bookId}，输出 ${OUT}`);
  } finally {
    await browser.close();
    server.stop();
  }
}

main().catch((err) => {
  console.error('✖ 截图失败：', err);
  process.exit(1);
});
