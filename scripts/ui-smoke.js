'use strict';

/**
 * 前端冒烟测试：起一个临时服务器，用 jsdom 真正跑一遍页面脚本，
 * 覆盖首页 → 练习 → 结果 → 词表 → 导入 → 关于 的渲染与点击。
 *
 *   node scripts/ui-smoke.js
 */

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.SMOKE_PORT || 3197);
const BASE = `http://127.0.0.1:${PORT}/`;

function waitFor(predicate, label, timeout = 15000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const value = predicate();
      if (value) return resolve(value);
      if (Date.now() - start > timeout) return reject(new Error(`等待超时：${label}`));
      setTimeout(tick, 50);
    };
    tick();
  });
}

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
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`服务提前退出（${code}）：\n${output}`));
    });
  });
}

async function main() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'worddrill-ui-'));
  const child = spawn(process.execPath, ['server.js', '--no-open', `--port=${PORT}`], {
    cwd: ROOT,
    env: { ...process.env, WORDDRILL_DATA: dataDir },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let dom;
  try {
    await waitReady(child);

    const html = await (await fetch(BASE)).text();
    const errors = [];
    const virtualConsole = new VirtualConsole();
    virtualConsole.on('jsdomError', (err) => errors.push(err));
    virtualConsole.on('error', (...args) => errors.push(new Error(args.join(' '))));

    dom = new JSDOM(html, {
      url: BASE,
      runScripts: 'dangerously',
      resources: 'usable',
      pretendToBeVisual: true,
      virtualConsole,
      beforeParse(window) {
        window.fetch = (input, init) => fetch(new URL(input, BASE), init);
        window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
        window.scrollTo = () => {};
      },
    });

    const { window } = dom;
    const doc = window.document;
    const text = () => doc.body.textContent.replace(/\s+/g, ' ');

    /* ---------- 首页 ---------- */
    await waitFor(() => doc.querySelector('#app .hero'), '首页渲染');
    assert.ok(text().includes('开始练习'), '首页应有开始按钮');
    assert.ok(text().includes('英译汉'), '首页应有模式卡');
    assert.equal(doc.querySelectorAll('.mode').length, 3, '应有三种模式');

    /* ---------- 练习 ---------- */
    doc.querySelector('[data-action="start"]').click();
    await waitFor(() => doc.querySelector('.prompt'), '练习页渲染');
    const options = [...doc.querySelectorAll('.opt')];
    assert.equal(options.length, 4, '选择题应有四个选项');
    assert.ok(doc.querySelector('.prompt').textContent.trim().length > 0, '题干不能为空');

    options[0].click();
    await waitFor(() => doc.querySelector('.feedback'), '提交后显示反馈');
    assert.ok(doc.querySelector('.opt.correct'), '应标出正确项');
    const next = doc.querySelector('[data-action="next"]');
    assert.ok(next, '应出现下一题按钮');
    next.click();
    await waitFor(() => doc.querySelector('.prompt'), '下一题渲染');
    assert.ok(text().includes('第 2 题'), '应进入第 2 题');

    /* ---------- 词表 ---------- */
    window.location.hash = '#/list';
    await waitFor(() => doc.querySelector('.word-row'), '词表渲染');
    assert.ok(doc.querySelector('.word-row .idx').textContent.trim() === '1', '第一行索引应为 1');
    assert.ok(text().includes('练习这些单词'));

    /* ---------- 导入页 ---------- */
    window.location.hash = '#/import';
    await waitFor(() => doc.querySelector('.drop'), '导入页渲染');
    const area = doc.getElementById('markdownInput');
    area.value = [
      '| # | 英文 | 词性 | 汉语 |',
      '|---|---|---|---|',
      '| 1 | competence | n. | 能力；胜任 |',
      '| 2 | tricky | adj. | 难对付的 |',
    ].join('\n');
    doc.querySelector('[data-action="preview"]').click();
    await waitFor(() => {
      const preview = doc.getElementById('preview');
      return preview && !preview.hidden && preview.textContent.includes('解析到 2 条');
    }, '导入预览');

    doc.getElementById('nameInput').value = '冒烟测试词库';
    doc.querySelector('[data-action="save-import"]').click();
    await waitFor(() => window.location.hash === '#/', '保存后回到首页');

    /* ---------- 默写模式 ---------- */
    doc.querySelector('[data-action="mode"][data-mode="spell"]').click();
    await waitFor(() => {
      const on = doc.querySelector('.mode.on b');
      return on && on.textContent === '单词默写';
    }, '切到单词默写');
    doc.querySelector('[data-action="start"]').click();
    await waitFor(() => doc.querySelector('.spell-hint'), '默写题渲染');
    const spellInput = doc.getElementById('spellInput');
    spellInput.value = 'zzz';
    spellInput.dispatchEvent(new window.Event('input', { bubbles: true }));
    doc.querySelector('[data-action="submit-spell"]').click();
    await waitFor(() => doc.querySelector('.feedback'), '默写反馈');
    assert.ok(text().includes('正确答案'), '默写答错应给出正确答案');

    /* ---------- 词表：屏蔽 / 恢复 ---------- */
    window.location.hash = '#/';
    await waitFor(() => doc.querySelector('.hero'), '回到首页');
    window.location.hash = '#/list';
    await waitFor(() => doc.querySelectorAll('.word-row').length === 2, '自组词库词表');
    doc.querySelector('[data-action="row-block"]').click();
    await waitFor(() => doc.querySelectorAll('.word-row').length === 1, '屏蔽后只剩一行');
    assert.ok(text().includes('已屏蔽（1）'), '词表应出现已屏蔽入口');
    assert.equal(doc.querySelector('.word-row .idx').textContent.trim(), '1', '屏蔽后索引从 1 重排');

    doc.querySelector('[data-action="show-blocked"]').click();
    await waitFor(() => doc.querySelector('[data-action="row-unblock"]'), '已屏蔽列表');
    doc.querySelector('[data-action="row-unblock"]').click();
    await waitFor(() => text().includes('还没有屏蔽任何单词'), '恢复后已屏蔽列表为空');

    /* ---------- 关于 ---------- */
    window.location.hash = '#/';
    await waitFor(() => doc.querySelector('.hero'), '回到首页');
    doc.querySelector('[data-action="about"]').click();
    await waitFor(() => doc.querySelector('.about-card'), '关于弹窗');
    assert.ok(doc.querySelector('.about-card').textContent.includes('版本 1.0.0'), '弹窗应显示版本');
    assert.ok(doc.querySelector('.about-card').textContent.includes('2816 .'), '弹窗应显示开发者');

    assert.deepEqual(errors.map((e) => e.message), [], `页面脚本报错：\n${errors.map((e) => e.stack).join('\n')}`);
    console.log('✔ UI 冒烟通过：首页 / 练习 / 默写 / 词表屏蔽 / 导入 / 关于');
  } finally {
    if (dom) dom.window.close();
    child.kill();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('✖ UI 冒烟失败：', err.message);
  process.exit(1);
});
