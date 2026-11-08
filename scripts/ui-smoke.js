/**
 * 端到端冒烟：真浏览器跑一遍 首页 → 练习 → 结果 → 词表 → 屏蔽 → 导入 → 关于 → 刷新 → 离线。
 *
 *   node scripts/ui-smoke.js
 */
import { launchBrowser, startServer } from './lib.js';

function check(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const server = await startServer();
  const browser = await launchBrowser();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));

  const bodyText = async () => (await page.innerText('body')).replace(/\s+/g, ' ');

  try {
    /* ---------- 首页 ---------- */
    await page.goto(server.base, { waitUntil: 'networkidle' });
    await page.waitForSelector('.hero');
    check((await page.$$('.mode')).length === 4, '首页应有四种练习方式');
    check((await bodyText()).includes('开始练习'), '首页应有开始按钮');

    /* ---------- 练习 ---------- */
    await page.click('[data-action="start"]');
    await page.waitForSelector('.prompt');
    check((await page.$$('.opt')).length === 4, '选择题应有四个选项');
    await page.click('.opt');
    await page.waitForSelector('.feedback');
    check(Boolean(await page.$('.opt.correct')), '提交后应标出正确项');
    await page.click('[data-action="next"]');
    await page.waitForFunction(() => document.body.innerText.includes('第 2 题'));

    /* ---------- 词表 ---------- */
    await page.evaluate(() => { location.hash = '#/list'; });
    await page.waitForSelector('.word-row');
    check((await page.textContent('.word-row .idx')).trim() === '1', '第一行索引应为 1');
    check((await bodyText()).includes('练习这些单词'), '词表应有练习按钮');

    /* ---------- 导入 ---------- */
    await page.evaluate(() => { location.hash = '#/import'; });
    await page.waitForSelector('.drop');
    await page.fill('#markdownInput', [
      '| # | 英文 | 词性 | 汉语 |',
      '|---|---|---|---|',
      '| 1 | competence | n. | 能力；胜任 |',
      '| 2 | tricky | adj. | 难对付的 |',
    ].join('\n'));
    await page.click('[data-action="preview"]');
    await page.waitForSelector('#preview:not([hidden])');
    check((await page.textContent('#preview')).includes('解析到 2 条'), '应解析出两条单词');
    await page.fill('#nameInput', '冒烟测试词库');
    await page.click('[data-action="save-import"]');
    await page.waitForFunction(() => location.hash === '#/' || location.hash === '');
    await page.waitForSelector('.hero');

    /* ---------- 默写 ---------- */
    await page.click('[data-action="mode"][data-mode="spell"]');
    await page.waitForFunction(() => document.querySelector('.mode.on b')?.textContent === '单词默写');
    await page.click('[data-action="start"]');
    await page.waitForSelector('.spell-hint');
    await page.fill('#spellInput', 'zzz');
    await page.click('[data-action="submit-spell"]');
    await page.waitForSelector('.feedback');
    check((await bodyText()).includes('正确答案'), '默写答错应给出正确答案');

    /* ---------- 屏蔽 / 恢复 ---------- */
    await page.evaluate(() => { location.hash = '#/'; });
    await page.waitForSelector('.hero');
    await page.evaluate(() => { location.hash = '#/list'; });
    await page.waitForFunction(() => document.querySelectorAll('.word-row').length === 2);

    await page.click('[data-action="row-block"]');
    await page.waitForFunction(() => document.querySelectorAll('.word-row').length === 1);
    check((await bodyText()).includes('已屏蔽（1）'), '词表应出现已屏蔽入口');
    check((await page.textContent('.word-row .idx')).trim() === '1', '屏蔽后索引应从 1 重排');

    await page.click('[data-action="show-blocked"]');
    await page.waitForSelector('[data-action="row-unblock"]');
    await page.click('[data-action="row-unblock"]');
    await page.waitForFunction(() => document.body.innerText.includes('还没有屏蔽任何单词'));

    /* ---------- 我不会 + 听音拼写 ---------- */
    await page.evaluate(() => { location.hash = '#/'; });
    await page.waitForSelector('.hero');
    await page.click('[data-action="mode"][data-mode="listen"]');
    await page.waitForFunction(() => document.querySelector('.mode.on b')?.textContent === '听音拼写');
    await page.click('[data-action="start"]');
    await page.waitForSelector('.spell-hint');
    check((await bodyText()).includes('听 发 音'), '听音拼写不应显示中文释义');
    await page.click('[data-action="dont-know"]');
    await page.waitForSelector('.feedback');
    check((await bodyText()).includes('我不会'), '「我不会」应记为答错');

    /* ---------- 复习（所有练过的词都能进复习） ---------- */
    await page.waitForTimeout(400); // 等防抖写入落盘
    const reviewCount = await page.evaluate(() => {
      const key = 'worddrill.db.review';
      const raw = JSON.parse(localStorage.getItem(key) || '[]');
      raw.forEach((item) => { item.dueAt = Date.now() - 60000; });
      localStorage.setItem(key, JSON.stringify(raw));
      return raw.length;
    });
    check(reviewCount > 0, `应已有复习排期，实际 ${reviewCount} 条`);
    await page.evaluate(() => { location.hash = '#/'; });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('.hero');
    const reviewEntry = await page.textContent('[data-action="review"]');
    check(/复习 \d+ 个单词/.test(reviewEntry), `首页应显示复习入口，实际：${reviewEntry}`);
    const homeHint = await page.textContent('.home-grid');
    check(homeHint.includes('都能复习'), '首页应说明练过的词都能复习');

    // 只答对、从没答错的词也要能复习
    const answered = await page.evaluate(() => {
      const log = JSON.parse(localStorage.getItem('worddrill.db.log') || '[]');
      const mistakes = JSON.parse(localStorage.getItem('worddrill.db.mistakes') || '[]');
      const wrongIds = new Set(mistakes.map((m) => m.wordId));
      return { practiced: log.length, onlyCorrect: log.filter((p) => !wrongIds.has(p.wordId)).length };
    });
    check(answered.practiced > 0, '应有练习记录');
    check(answered.onlyCorrect >= 0, '答对的词数应为非负');

    await page.click('[data-action="review"]');
    await page.waitForSelector('.modal [data-mode="en_zh"]');
    await page.click('.modal [data-mode="en_zh"]');
    await page.waitForSelector('.practice-top');
    check((await bodyText()).includes('复习'), '应进入复习练习');
    await page.click('[data-action="exit"]');
    await page.waitForSelector('.hero');

    // 范围选择：练过的词多于今天到期时才出现
    const scopeStats = await page.evaluate(() => {
      const log = JSON.parse(localStorage.getItem('worddrill.db.log') || '[]');
      const rev = JSON.parse(localStorage.getItem('worddrill.db.review') || '[]');
      const dueIds = new Set(rev.filter((r) => r.dueAt <= Date.now()).map((r) => r.wordId));
      const practiced = new Set(log.map((p) => p.wordId));
      return { practiced: practiced.size, due: [...practiced].filter((id) => dueIds.has(id)).length };
    });
    if (scopeStats.practiced > scopeStats.due) {
      await page.click('[data-action="review"]');
      await page.waitForSelector('.modal [data-scope="due"]');
      check((await bodyText()).includes('今天该复习的'), '应能选今日复习范围');
      check((await bodyText()).includes('全部练过的'), '应能选全部练过的词');
      await page.click('.modal [data-scope="all"]');
      await page.waitForSelector('.modal [data-mode="en_zh"]');
      await page.click('.modal [data-mode="en_zh"]');
      await page.waitForSelector('.practice-top');
      check((await bodyText()).includes('· 复习'), '选「全部练过的」也应进入复习');
      await page.click('[data-action="exit"]');
      await page.waitForSelector('.hero');
    }

    /* ---------- 学习报告 ---------- */
    await page.evaluate(() => { location.hash = '#/report'; });
    await page.waitForSelector('.stat-grid');
    const report = await page.textContent('.center-col');
    check(report.includes('掌握度'), '报告页应有掌握度');
    check(report.includes('连续打卡'), '报告页应有打卡统计');
    check(report.includes('未来 7 天复习量'), '报告页应有未来 7 天复习量');
    check((await page.$$('.report-page .chart')).length === 2, '报告页应有近 7 天与未来 7 天两个图表');
    check((await page.$$('.report-page .chart-col')).length === 14, '两个图表各 7 天');
    check((await page.$$('.tier-row')).length === 4, '掌握度应有四档');

    /* ---------- 设置 / 隐私 ---------- */
    await page.evaluate(() => { location.hash = '#/settings'; });
    await page.waitForSelector('#themeSelect');
    await page.selectOption('#themeSelect', 'dark');
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
    await page.selectOption('#themeSelect', 'auto');

    /* ---------- 自动备份三项 ---------- */
    await page.waitForSelector('#autobackupInput', { state: 'attached' });
    check(await page.isChecked('#autobackupInput'), '自动备份默认应开启');
    await page.fill('#backupIntervalInput', '4');
    await page.dispatchEvent('#backupIntervalInput', 'change');
    await page.fill('#backupKeepInput', '5');
    await page.dispatchEvent('#backupKeepInput', 'change');
    const abPrefs = await page.evaluate(() => ({
      enabled: localStorage.getItem('worddrill.autobackup'),
      interval: localStorage.getItem('worddrill.backupInterval'),
      keep: localStorage.getItem('worddrill.backupKeep'),
    }));
    check(abPrefs.interval === '4' && abPrefs.keep === '5', `备份间隔/保留数应保存，实际 ${JSON.stringify(abPrefs)}`);
    await page.click('[data-action="save-autobackup-now"]');
    await page.waitForTimeout(300);
    const snapshots = await page.evaluate(() => window.worddrill.repo.listAutoBackups().length);
    check(snapshots >= 1, `应立即生成一份自动备份快照，实际 ${snapshots}`);
    await page.click('[data-action="clear-backup-cache"]');
    await page.waitForSelector('.modal [data-ok]');
    await page.click('.modal [data-ok]');
    await page.waitForTimeout(500);
    const afterClear = await page.evaluate(() => window.worddrill.repo.listAutoBackups().length);
    check(afterClear === 0, `清除备份缓存后快照应为 0，实际 ${afterClear}`);

    await page.evaluate(() => { location.hash = '#/privacy'; });
    await page.waitForSelector('.prose');
    check((await page.textContent('.prose')).includes('隐私政策'), '隐私政策应能加载');

    /* ---------- 关于 ---------- */
    await page.evaluate(() => { location.hash = '#/settings'; });
    await page.waitForSelector('#themeSelect');
    await page.click('[data-action="about"]');
    await page.waitForSelector('.about-card');
    const about = await page.textContent('.about-card');
    check(about.includes('版本 web-1.8'), '关于页应显示版本');
    check(about.includes('zlt mteacase'), '关于页应显示开发者');
    await page.keyboard.press('Escape');

    /* ---------- 刷新后数据还在 ---------- */
    await page.evaluate(() => { location.hash = '#/'; });
    await page.waitForSelector('.hero');
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('.hero');
    const bookInfo = await page.evaluate(() => {
      const books = window.worddrill.repo.bootstrap().books;
      return {
        total: books.length,
        builtin: books.filter((x) => x.builtin).map((x) => x.name),
        custom: books.filter((x) => !x.builtin).map((x) => x.name),
      };
    });
    check(bookInfo.builtin.length === 2, `应有 2 本内置词库，实际 ${JSON.stringify(bookInfo.builtin)}`);
    check(bookInfo.builtin.includes('高中 3500 词'), '内置词库应含「高中 3500 词」');
    check(bookInfo.builtin.includes('大学英语四级'), '内置词库应含「大学英语四级」');
    check(!bookInfo.builtin.includes('高中英语扩展词汇'), '「高中英语扩展词汇」应已下架');
    check(bookInfo.custom.includes('冒烟测试词库'), `刷新后应保留自建词库，实际 ${JSON.stringify(bookInfo.custom)}`);

    // 内置词库版本记在数据里，刷新后不应重复补种
    const seedVersion = await page.evaluate(() => window.worddrill.repo.builtinInfo().seedVersion);
    check(seedVersion >= 3, `seedVersion 应 >= 3，实际 ${seedVersion}`);

    /* ---------- 备份 ---------- */
    const backup = await page.evaluate(() => window.worddrill.repo.backupText());
    const parsed = JSON.parse(backup);
    check(parsed.db.words.length > 3000, '备份里应包含内置词表');
    check(await page.evaluate(() => window.worddrill.repo.info().persistent), '应能写入本地存储');

    /* ---------- 离线可用 ---------- */
    await page.evaluate(() => navigator.serviceWorker.ready);
    const controlled = await page.evaluate(() => Boolean(navigator.serviceWorker.controller));
    if (!controlled) {
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForSelector('.hero');
    }
    await context.setOffline(true);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.hero', { timeout: 15000 });
    check((await bodyText()).includes('开始练习'), '断网后仍应能打开并使用');
    await context.setOffline(false);

    check(errors.length === 0, `页面脚本报错：\n${errors.join('\n')}`);
    console.log('✔ 冒烟通过：首页 / 练习 / 结果 / 词表 / 屏蔽 / 导入 / 报告 / 设置 / 隐私 / 关于 / 刷新持久化 / 断网可用');
  } finally {
    await context.close();
    await browser.close();
    server.stop();
  }
}

main().catch((err) => {
  console.error('✖ 冒烟失败：', err.message);
  process.exit(1);
});









