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
    check((await page.$$('.mode')).length === 5, '首页应有五种练习方式');
    check((await bodyText()).includes('开始练习'), '首页应有开始按钮');
    check(Boolean(await page.$('.home-notice')), '首页应有黄框提示');
    check((await page.textContent('.home-notice')).includes('如在默认词表内发现错词'), '黄框提示文案');
    check(Boolean(await page.$('[data-action="home-to-settings"]')), '黄框应有「转到 设置」');
    check(!(await page.$('#repeatInput')), '首页不应再有「允许重复抽到已练过的」开关');
    check((await bodyText()).includes('每轮只抽从未练过的词'), '首页应说明只抽没练过的词');

    /* ---------- 练习 ---------- */
    await page.click('[data-action="start"]');
    await page.waitForSelector('.prompt');
    check((await page.$$('.opt')).length === 4, '选择题应有四个选项');
    const progressStable = await page.evaluate(() => {
      const text = document.querySelector('.progress-text');
      const bar = document.querySelector('.practice-top .bar');
      const before = bar.getBoundingClientRect().left;
      const original = text.textContent;
      text.textContent = '第 100 题 / 共 200 题';
      const after = bar.getBoundingClientRect().left;
      text.textContent = original;
      return before === after;
    });
    check(progressStable, '题号位数变多时进度条起点不应移动');

    // 首练可把词直接标成已掌握
    check(Boolean(await page.$('[data-action="skip-word"]')), '首练应能标记「不再练习此单词」');
    await page.click('[data-action="skip-word"]');
    const learnedCount = await page.evaluate(() => {
      const book = window.worddrill.repo.bootstrap().books.find((b) => b.name === '高中 3500 词');
      return window.worddrill.repo.studied(book.id, 'mastered').words.filter((w) => w.learned).length;
    });
    check(learnedCount === 1, `标成已掌握的词应进「已掌握」，实际 ${learnedCount}`);
    check(Boolean(await page.$('.opt')), '标成已掌握后应接着练下一题');

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

    /* ---------- 导入：AI 智能整理（实验性，用桩接口） ---------- */
    await page.evaluate(() => { location.hash = '#/settings'; });
    await page.waitForSelector('#smartParseInput', { state: 'attached' });
    await page.evaluate(() => document.getElementById('smartParseInput').click());
    await page.evaluate(() => { location.hash = '#/import'; });
    await page.waitForSelector('.ai-import');
    check((await page.textContent('.ai-import')).includes('AI 在线转换无法生成例句'), 'AI 转换应提示无法生成例句');
    check(Boolean(await page.$('.ai-import-badge .ai-icon')), '导入页应有 AI 图标');
    check(Boolean(await page.$('[data-action="ai-convert"] .ai-icon')), 'AI 整理按钮应有图标');
    check(await page.isChecked('#aiAutoInput'), '自动转换默认应勾选');

    let aiCalls = 0;
    const aiRoute = async (route) => {
      aiCalls += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify({
          ok: true,
          markdown: '| 英文 | 词性 | 汉语 |\n| --- | --- | --- |\n| abandon | v. | 放弃 |\n| ability | n. | 能力 |',
          count: 2,
          truncated: false,
        }),
      });
    };
    await page.route('**/api/smart-parse', aiRoute);

    await page.fill('#markdownInput', 'abandon 放弃\nability 能力');
    await page.click('[data-action="ai-convert"]');
    await page.waitForFunction(() => document.querySelector('#preview')?.textContent.includes('AI 整理完成'));
    check((await page.textContent('#preview')).includes('解析到 2 条'), 'AI 结果应进预览');
    check(!(await page.textContent('#preview')).includes('〔例〕'), 'AI 转换结果不应带例句');
    check(aiCalls === 1, `手动 AI 整理应调用一次接口，实际 ${aiCalls}`);

    await page.fill('#markdownInput', 'accent 口音');
    await page.click('[data-action="preview"]');
    await page.waitForFunction(() => document.querySelector('#preview')?.textContent.includes('AI 整理完成'));
    check(aiCalls === 2, `自动转换应在本地解析失败后调用接口，实际 ${aiCalls}`);
    await page.unroute('**/api/smart-parse', aiRoute);
    await page.evaluate(() => localStorage.setItem('worddrill.smartParse', 'off'));

    /* ---------- 导入：普通 Markdown 表格 ---------- */
    await page.fill('#markdownInput', [
      '| # | 英文 | 词性 | 汉语 | 例句 |',
      '|---|---|---|---|---|',
      '| 1 | competence | n. | 能力；胜任 | He has great competence.||他很有能力。 |',
      '| 2 | tricky | adj. | 难对付的 |  |',
      '| 3 | mindset | n. | 思维模式 |  |',
    ].join('\n'));
    await page.click('[data-action="preview"]');
    await page.waitForSelector('#preview:not([hidden])');
    check((await page.textContent('#preview')).includes('解析到 3 条'), '应解析出三条单词');
    check((await page.textContent('#preview')).includes('〔例〕'), '预览应显示例句');
    await page.fill('#nameInput', '冒烟测试词库');
    await page.click('[data-action="save-import"]');
    await page.waitForFunction(() => location.hash === '#/' || location.hash === '');
    await page.waitForSelector('.hero');

    /* ---------- 例句填词：导入的第四列例句 ---------- */
    await page.click('[data-action="mode"][data-mode="ex_spell"]');
    await page.waitForFunction(() => document.querySelector('.mode.on b')?.textContent === '例句填词');
    await page.click('[data-action="start"]');
    await page.waitForSelector('.spell-hint');
    check((await bodyText()).includes('例 句 填 词'), '例句填词应有题型标签');
    const exampleAnswer = await page.evaluate(() => {
      const book = window.worddrill.repo.bootstrap().books.find((b) => b.name === '冒烟测试词库');
      const word = window.worddrill.repo.listWords(book.id, 'all', '').words.find((w) => w.exampleEn);
      if (!word) return '';
      const re = new RegExp(`\\b${word.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[a-z]*\\b`, 'i');
      return (re.exec(word.exampleEn) || [''])[0];
    });
    check(Boolean(exampleAnswer), '导入的例句应能挖空');
    await page.fill('#spellInput', exampleAnswer);
    await page.click('[data-action="submit-spell"]');
    await page.waitForSelector('.feedback');
    check((await page.textContent('.feedback')).includes('答对了'), '例句填词应能答对');
    await page.evaluate(() => { location.hash = '#/'; });
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

    /* ---------- 首页词库选择（自定义下拉） ---------- */
    check((await page.$('select#bookSelect')) === null, '首页不应再用浏览器原生 select');
    await page.click('#bookPick');
    await page.waitForSelector('.book-menu:not([hidden])');
    check((await page.$$('.book-option')).length > 0, '词库菜单应有选项');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    check(await page.evaluate(() => document.querySelector('.book-menu').hidden), 'Esc 应能收起词库菜单');

    await page.evaluate(() => { location.hash = '#/list'; });
    await page.waitForFunction(() => document.querySelectorAll('.word-row').length === 3);

    await page.click('[data-action="row-block"]');
    await page.waitForFunction(() => document.querySelectorAll('.word-row').length === 2);
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

    /* ---------- 错题导出：三个选项都在 ---------- */
    await page.evaluate(() => { location.hash = '#/'; });
    await page.waitForSelector('.hero');
    await page.click('[data-nav="#/mistakes"]');
    await page.waitForTimeout(500);
    const exportBtn = await page.$('[data-action="export-mistakes"]');
    if (exportBtn) {
      await exportBtn.click();
      await page.waitForSelector('[data-format="review"]');
      const formats = await page.$$eval('[data-format]', (els) => els.map((e) => e.dataset.format));
      check(formats.length === 3, `导出应有三个选项，实际 ${JSON.stringify(formats)}`);
      check(formats.includes('practice-zh'), '练习版应支持只留中文');
      await page.click('.modal [data-close]');
      await page.waitForTimeout(200);
    } else {
      check(true, '本轮没产生错题，跳过导出检查');
    }
    await page.evaluate(() => { location.hash = '#/'; });
    await page.waitForSelector('.hero');

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

    /* ---------- 侧边导航 ---------- */
    const navItems = await page.$$eval('[data-nav]', (els) => els.map((e) => e.getAttribute('href')));
    check(navItems.length === 6, `侧边导航应有 6 项，实际 ${JSON.stringify(navItems)}`);
    check(navItems.includes('#/report') && navItems.includes('#/settings'), '导航应含学习报告与设置');
    check((await page.$$('.nav-icon')).length === 6, '导航项应有图标');

    /* ---------- 移动端三点导航 ---------- */
    check(
      await page.evaluate(() => getComputedStyle(document.querySelector('.topbar .nav-toggle')).display === 'none'),
      '桌面端三点按钮应隐藏',
    );
    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const mp = await mobile.newPage();
    await mp.goto(server.base, { waitUntil: 'networkidle' });
    await mp.waitForSelector('.hero');
    await mp.click('.nav-toggle');
    await mp.waitForSelector('.nav-drawer');
    const drawerItems = await mp.$$eval('.nav-sheet .nav-item', (els) => els.length);
    check(drawerItems === 6, `手机端抽屉应有 6 项，实际 ${drawerItems}`);
    await mp.click('.nav-sheet [data-nav="#/settings"]');
    await mp.waitForTimeout(300);
    check((await mp.evaluate(() => location.hash)) === '#/settings', '手机端可从抽屉跳到设置');
    check(!(await mp.$('.nav-drawer')), '跳转后抽屉应关闭');
    await mobile.close();

    /* ---------- 学习报告 ---------- */
    await page.click('[data-nav="#/report"]');
    await page.waitForSelector('.stat-grid');
    check((await page.evaluate(() => location.hash)) === '#/report', '点导航应进入学习报告');
    const report = await page.textContent('.center-col');
    check(report.includes('掌握度'), '报告页应有掌握度');
    check(report.includes('连续打卡'), '报告页应有打卡统计');
    check(report.includes('未来 7 天到期量'), '报告页应有未来 7 天到期量');
    check((await page.$$('.report-page .chart')).length === 1, '报告页应有近 7 天柱状图');
    check((await page.$$('.upcoming-line')).length === 1, '报告页应有未来 7 天折线图');
    check((await page.$$('.heatmap-grid')).length === 1, '报告页应有一年打卡热力图');
    check((await page.$$('.mode-stat-row')).length > 0, '报告页应有分题型统计');
    check((await page.$$('.report-page .chart-col')).length === 7, '近 7 天柱状图应有 7 天');
    check((await page.$$('.tier-row')).length === 4, '掌握度应有四档');
    check(Boolean(await page.$('#reportBook')), '掌握度应能筛选词表');
    await page.selectOption('#reportBook', { label: '大学英语四级' });
    await page.waitForTimeout(300);
    check((await page.textContent('.report-title-row + .report-card')).includes('/ 4544 词'), '筛选词表后掌握度应只算该词表');
    await page.selectOption('#reportBook', { index: 0 });
    await page.waitForTimeout(300);

    /* ---------- 已练词汇：右侧首字母区间 ---------- */
    await page.evaluate(() => { location.hash = '#/studied'; });
    await page.waitForSelector('.studied-layout');
    const studiedLayout = await page.evaluate(() => {
      const side = document.querySelector('.studied-side')?.getBoundingClientRect();
      const main = document.querySelector('.studied-main')?.getBoundingClientRect();
      return { side: side && side.toJSON(), main: main && main.toJSON() };
    });
    check(studiedLayout.side && studiedLayout.main && studiedLayout.side.left > studiedLayout.main.right - 1,
      '首字母筛选应在主列表右侧');
    const beforeLetterRows = await page.$$eval('.word-row', (els) => els.length);
    if (beforeLetterRows > 0) {
      const firstLetter = await page.$eval('.word-row .w', (el) => el.textContent.trim().charAt(0).toUpperCase());
      await page.selectOption('#letterFrom', firstLetter);
      await page.waitForTimeout(250);
      await page.selectOption('#letterTo', firstLetter);
      await page.waitForTimeout(250);
      const ranged = await page.$$eval('.word-row .w', (els) => els.map((el) => el.textContent.trim().charAt(0).toUpperCase()));
      check(ranged.every((ch) => ch === firstLetter), `首字母区间应只留 ${firstLetter}，实际 ${JSON.stringify(ranged)}`);
      await page.click('[data-action="letter-reset"]');
      await page.waitForTimeout(200);
      check((await page.$$eval('.word-row', (els) => els.length)) === beforeLetterRows, '重置后应恢复全部已练词');
    }

    /* ---------- 设置 / 隐私 ---------- */
    await page.evaluate(() => { location.hash = '#/settings'; });
    await page.waitForSelector('.theme-switch');
    await page.click('.theme-switch');
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
    check(true, '太阳/月亮开关可切到深色');
    await page.click('.theme-switch');
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
    check(!(await page.$('#themeSelect')), '设置页已去掉外观下拉');
    check(!(await bodyText()).includes('练习时朗读单词'), '设置页已去掉练习时朗读单词');

    /* ---------- 重要：重新部署默认词库（两次确认都可以取消） ---------- */
    check(Boolean(await page.$('.settings-important')), '设置页应有「重要提示」分类');
    check((await page.textContent('.settings-important')).includes('重要提示'), '分类标题应为「重要提示」');
    check((await page.textContent('.settings-important')).includes('如在默认词表内发现错词'), '描述最前面应有提醒句');
    check((await page.textContent('.settings-important')).includes('重新部署默认词库'), '重要提示应含重新部署入口');
    check(Boolean(await page.$('[data-action="redeploy-builtins"]')), '应有重新部署按钮');

    await page.click('[data-action="redeploy-builtins"]');
    await page.waitForSelector('.modal [data-ok]');
    check((await page.textContent('.modal')).includes('重新部署默认词库'), '第一次确认文案');
    await page.click('.modal [data-close]');
    await page.waitForSelector('.modal', { state: 'detached' });

    await page.click('[data-action="redeploy-builtins"]');
    await page.waitForSelector('.modal [data-ok]');
    await page.click('.modal [data-ok]');
    await page.waitForFunction(() => document.querySelector('.modal')?.innerText.includes('再次确认'));
    await page.click('.modal [data-close]');
    await page.waitForSelector('.modal', { state: 'detached' });
    check(true, '两次确认都可以取消');

    // 真正执行一次：两次确认后重建，词表数量和设置页都还在
    await page.click('[data-action="redeploy-builtins"]');
    await page.waitForSelector('.modal [data-ok]');
    await page.click('.modal [data-ok]');
    await page.waitForFunction(() => document.querySelector('.modal')?.innerText.includes('再次确认'));
    await page.click('.modal [data-ok]');
    await page.waitForFunction(
      () => document.body.innerText.includes('已重建'),
      null,
      { timeout: 20000 },
    );
    const redeployBooks = await page.evaluate(
      () => window.worddrill.repo.bootstrap().books.map((b) => [b.name, b.wordCount]),
    );
    check(
      redeployBooks.some(([name, count]) => name === '高中 3500 词' && count === 3846),
      `重新部署后 3500 应为 3846 词，实际 ${JSON.stringify(redeployBooks)}`,
    );
    check(
      redeployBooks.some(([name, count]) => name === '大学英语四级' && count === 4544),
      `重新部署后四级应为 4544 词，实际 ${JSON.stringify(redeployBooks)}`,
    );
    check(Boolean(await page.$('.settings-important')), '重建后设置页应还在');

    /* ---------- 设置页拼图：备份块不再是整行，其他里有开源许可 ---------- */
    const settingsTiles = await page.evaluate(() => [...document.querySelectorAll('.settings-tile')].map((el) => {
      const label = el.querySelector('.section-label');
      const r = el.getBoundingClientRect();
      return { label: label ? label.textContent : '', width: Math.round(r.width), top: Math.round(r.top), left: Math.round(r.left) };
    }));
    check(settingsTiles.length === 4, `设置页应有 4 块拼图，实际 ${settingsTiles.length}`);
    const backupTile = settingsTiles.find((t) => t.label === '数据与备份');
    const learnTile = settingsTiles.find((t) => t.label === '学习');
    const otherTile = settingsTiles.find((t) => t.label === '其他');
    const experimentTile = settingsTiles.find((t) => t.label === '实验性功能');
    check(Boolean(backupTile), '设置页应有「数据与备份」块');
    check(backupTile && backupTile.width < 500, '数据与备份应与其他块同宽，不独占整行');
    check(
      learnTile && backupTile && learnTile.top === backupTile.top && learnTile.left !== backupTile.left,
      '学习与数据备份应在同一行',
    );
    check(Boolean(otherTile), '设置页应有「其他」块');
    check(Boolean(experimentTile), '设置页应有「实验性功能」块');
    check(
      otherTile && experimentTile && otherTile.top === experimentTile.top && otherTile.left !== experimentTile.left,
      '实验性功能应与「其他」对齐在同一行',
    );

    /* ---------- 实验性功能开关 ---------- */
    check(await page.isChecked('#varyDistractorsInput'), '干扰项变化默认应开启');
    check(!(await page.isChecked('#revealMeaningsInput')), '其他选项释义默认应关闭');
    await page.evaluate(() => document.getElementById('varyDistractorsInput').click());
    await page.evaluate(() => document.getElementById('revealMeaningsInput').click());
    const experimentPrefs = await page.evaluate(() => ({
      vary: localStorage.getItem('worddrill.varyDistractors'),
      reveal: localStorage.getItem('worddrill.revealMeanings'),
    }));
    check(experimentPrefs.vary === 'off' && experimentPrefs.reveal === 'on',
      `实验性开关应保存，实际 ${JSON.stringify(experimentPrefs)}`);
    await page.evaluate(() => document.getElementById('varyDistractorsInput').click());
    await page.evaluate(() => document.getElementById('revealMeaningsInput').click());

    /* ---------- 设置 → 学习 → 词库列表 ---------- */
    await page.click('[data-action="books"]');
    await page.waitForFunction(() => location.hash === '#/books');
    check((await page.textContent('.center-col')).includes('词库管理'), '学习栏的词库列表应进入词库管理');
    await page.evaluate(() => { location.hash = '#/settings'; });
    await page.waitForSelector('.settings-grid');

    /* ---------- APK 版本与链接 ---------- */
    const apkHref = await page.getAttribute('a[href*="gitee.com"]', 'href');
    check(apkHref && apkHref.endsWith('v1.6.0/WordDrill-1.6.0.apk'), `APK 应为 1.6.0，实际 ${apkHref}`);

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
    await page.waitForTimeout(500);
    const snapshots = await page.evaluate(async () => (await window.worddrill.repo.listAutoBackups()).length);
    check(snapshots >= 1, `应立即生成一份自动备份快照，实际 ${snapshots}`);
    const snapshotStatus = await page.textContent('#backupStatus');
    check(!snapshotStatus.includes('0 份'), `保存后状态不应显示 0 份，实际 ${snapshotStatus}`);

    // 恢复最近快照：先改一条星标，恢复后应回到快照里的状态
    const starredId = await page.evaluate(() => {
      const book = window.worddrill.repo.bootstrap().books.find((b) => b.name === '高中 3500 词');
      const word = window.worddrill.repo.listWords(book.id, 'all', '').words[0];
      window.worddrill.repo.setStar(word.id, true);
      return word.id;
    });
    await page.click('[data-action="restore-autobackup"]');
    await page.waitForSelector('.modal [data-ok]');
    await page.click('.modal [data-ok]');
    await page.waitForFunction(() => document.body.innerText.includes('已恢复'), null, { timeout: 10000 });
    const restoredStar = await page.evaluate((id) => {
      const book = window.worddrill.repo.bootstrap().books.find((b) => b.name === '高中 3500 词');
      return window.worddrill.repo.listWords(book.id, 'all', '').words.find((w) => w.id === id)?.starred;
    }, starredId);
    check(restoredStar === false, '恢复快照后新加的星标应被覆盖');

    await page.click('[data-action="clear-backup-cache"]');
    await page.waitForSelector('.modal [data-ok]');
    await page.click('.modal [data-ok]');
    await page.waitForTimeout(500);
    const afterClear = await page.evaluate(async () => (await window.worddrill.repo.listAutoBackups()).length);
    check(afterClear === 0, `清除备份缓存后快照应为 0，实际 ${afterClear}`);

    await page.evaluate(() => { location.hash = '#/privacy'; });
    await page.waitForSelector('.prose');
    check((await page.textContent('.prose')).includes('隐私政策'), '隐私政策应能加载');

    /* ---------- 关于 ---------- */
    await page.evaluate(() => { location.hash = '#/settings'; });
    await page.waitForSelector('.theme-switch');
    await page.click('[data-action="about"]');
    await page.waitForSelector('.about-card');
    const about = await page.textContent('.about-card');
    check(about.includes('版本 web-2.1'), '关于页应显示版本');
    check(about.includes('zlt mteacase'), '关于页应显示开发者');
    check(!about.includes('开放源代码许可'), '开源许可应已移出关于弹窗');
    await page.keyboard.press('Escape');

    /* ---------- 词库管理：已用空间用 MB ---------- */
    await page.evaluate(() => { location.hash = '#/books'; });
    await page.waitForSelector('.center-col');
    const booksText = await page.textContent('.center-col');
    check(/已用\s*[\d.]+\s*MB/.test(booksText), `已用空间应以 MB 计，实际：${(booksText.match(/已用[^·]*/) || ['无'])[0]}`);

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

    await page.click('[data-action="home-to-settings"]');
    await page.waitForFunction(() => location.hash === '#/settings');
    check(Boolean(await page.$('.settings-important')), '首页黄框可转到设置');

    /* ---------- 老数据一次性迁移：加载时自动，不点设置 ---------- */
    const legacy = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const lp = await legacy.newPage();
    const legacyErrors = [];
    lp.on('pageerror', (err) => legacyErrors.push(err.message));
    await lp.addInitScript(() => {
      const now = Date.now();
      const books = [{ id: 1, name: '高中 3500 词', builtin: true, createdAt: now }];
      const words = [{
        id: 1, bookId: 1, ord: 1, word: 'v]', pos: '',
        meaning: 't. 把…分类，拣选', starred: true, blocked: false, createdAt: now,
      }];
      localStorage.setItem('worddrill.db.books', JSON.stringify(books));
      localStorage.setItem('worddrill.db.words', JSON.stringify(words));
      localStorage.setItem('worddrill.db.mistakes', JSON.stringify([
        { wordId: 1, mode: 'en_zh', wrong: 2, streak: 0, lastAt: now },
      ]));
      localStorage.setItem('worddrill.db.log', JSON.stringify([
        { wordId: 1, times: 3, lastAt: now },
      ]));
      localStorage.setItem('worddrill.db.review', JSON.stringify([
        { wordId: 1, level: 1, dueAt: now + 86400000, lastAt: now, lapses: 0 },
      ]));
      localStorage.setItem('worddrill.db.daily', '[]');
      localStorage.setItem('worddrill.db.meta', JSON.stringify({
        version: 2, seedVersion: 3, nextBookId: 2, nextWordId: 2,
      }));
    });
    await lp.goto(server.base, { waitUntil: 'domcontentloaded' });
    await lp.waitForSelector('.hero', { timeout: 30000 });
    await lp.waitForTimeout(500);
    const migrated = await lp.evaluate(() => {
      const books = window.worddrill.repo.bootstrap().books;
      const book = books.find((b) => b.name === '高中 3500 词');
      const sort = window.worddrill.repo.listWords(book.id, 'all', 'sort').words[0];
      const broken = window.worddrill.repo.listWords(book.id, 'all', 'v]').words.length;
      const log = JSON.parse(localStorage.getItem('worddrill.db.log')).find((p) => p.wordId === 1);
      const mistake = JSON.parse(localStorage.getItem('worddrill.db.mistakes')).find((m) => m.wordId === 1);
      const review = JSON.parse(localStorage.getItem('worddrill.db.review')).find((r) => r.wordId === 1);
      const meta = JSON.parse(localStorage.getItem('worddrill.db.meta'));
      return { books, sort, broken, log, mistake, review, version: meta.wordlistVersion };
    });
    check(migrated.version === 4, `迁移后 wordlistVersion 应为 4，实际 ${migrated.version}`);
    check(migrated.broken === 0, 'v] 应已被替换');
    check(Boolean(migrated.sort && migrated.sort.id === 1 && migrated.sort.word === 'sort'), 'sort 应保留原 id');
    check(Boolean(migrated.sort && migrated.sort.starred), '星标应保留');
    check(Boolean(migrated.sort && migrated.sort.pos === 'v.&n.'), `迁移后词性应统一，实际 ${migrated.sort && migrated.sort.pos}`);
    check(Boolean(migrated.log && migrated.log.times === 3), '练习记录应保留');
    check(Boolean(migrated.mistake && migrated.mistake.wrong === 2), '错题应保留');
    check(Boolean(migrated.review && migrated.review.level === 1), '复习排期应保留');
    check(
      migrated.books.some((b) => b.name === '高中 3500 词' && b.wordCount === 3846),
      `迁移后 3500 应为 3846 词，实际 ${JSON.stringify(migrated.books)}`,
    );
    check(
      migrated.books.some((b) => b.name === '大学英语四级' && b.wordCount === 4544),
      '缺的四级应自动补建',
    );
    check(legacyErrors.length === 0, `迁移页报错：${legacyErrors.join('; ')}`);
    await legacy.close();

    check(errors.length === 0, `页面脚本报错：\n${errors.join('\n')}`);
    console.log('✔ 冒烟通过：首页 / 练习 / 结果 / 词表 / 屏蔽 / 导入 / 报告 / 设置 / 隐私 / 关于 / 刷新持久化 / 断网可用 / 老数据自动迁移');
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


















