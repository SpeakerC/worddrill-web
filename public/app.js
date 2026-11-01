'use strict';

/* ============================================================
 * 单词练习 Web 版 · 前端
 * 单页应用，hash 路由：#/、#/list、#/books、#/import、#/practice、#/result
 * ============================================================ */

const app = document.getElementById('app');
const toastEl = document.getElementById('toast');

const esc = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[ch]));

function toast(message) {
  toastEl.textContent = message;
  toastEl.hidden = false;
  requestAnimationFrame(() => toastEl.classList.add('show'));
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => {
    toastEl.classList.remove('show');
    setTimeout(() => { toastEl.hidden = true; }, 220);
  }, 2200);
}

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch { /* 空响应 */ }
  if (!res.ok) throw new Error(data.error || `请求失败（${res.status}）`);
  return data;
}

/* ---------- 状态 ---------- */

const state = {
  books: [],
  bookId: null,
  mode: 'en_zh',
  modes: {},
  about: null,
  count: 20,
  start: null,
  end: null,
  allowRepeat: false,
  stats: null,
  practice: null,
  result: null,
  listFilter: 'all',
  search: '',
  importBookId: null,
  searchTimer: null,
};

const currentBook = () => state.books.find((b) => b.id === state.bookId) || null;
const modeLabel = (key) => (state.modes[key] || {}).label || '练习';

/* ---------- 路由 ---------- */

async function boot() {
  const data = await api('/api/bootstrap');
  state.books = data.books;
  state.modes = data.modes;
  state.about = data.about;
  const saved = Number(localStorage.getItem('worddrill.bookId') || 0);
  const found = state.books.find((b) => b.id === saved);
  state.bookId = found ? found.id : (state.books[0] ? state.books[0].id : null);
  const savedMode = localStorage.getItem('worddrill.mode');
  if (savedMode && state.modes[savedMode]) state.mode = savedMode;
  await route();
}

async function route() {
  const hash = location.hash.replace(/^#\/?/, '');
  const [name] = hash.split('/');
  try {
    if (name === 'practice') return renderPractice();
    if (name === 'result') return renderResult();
    if (name === 'list') return renderList();
    if (name === 'books') return renderBooks();
    if (name === 'import') return renderImport();
    return renderHome();
  } catch (err) {
    app.innerHTML = `${topbar()}<div class="card"><p>出错了：${esc(err.message)}</p>
      <button class="btn" data-action="home">回到首页</button></div>`;
  }
}

window.addEventListener('hashchange', () => { route(); });

/* ---------- 通用片段 ---------- */

function topbar() {
  return `
    <header class="topbar">
      <h1>单词练习 <span class="sub">Web</span></h1>
      <div class="topbar-actions">
        <button class="btn text" data-action="about">关于</button>
      </div>
    </header>`;
}

function pageHead(title, extra = '') {
  return `
    <div class="page-head">
      <button class="icon-btn" data-action="home" title="返回首页">←</button>
      <h2>${esc(title)}</h2>
      <div class="grow"></div>
      ${extra}
    </div>`;
}

function openModal(html) {
  const overlay = document.createElement('div');
  overlay.className = 'modal';
  overlay.innerHTML = html;
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay || event.target.closest('[data-close]')) overlay.remove();
  });
  document.body.appendChild(overlay);
  return overlay;
}

function closeModal(el) {
  if (el) el.remove();
}

/* ---------- 首页 ---------- */

async function renderHome() {
  const book = currentBook();
  if (!book) {
    app.innerHTML = `${topbar()}<div class="empty">还没有词库，先去「词库管理」导入一个吧。</div>`;
    return;
  }
  const stats = await api(`/api/books/${book.id}/stats`);
  state.stats = stats;
  const max = stats.range ? stats.range.end : 0;
  if (state.start == null || state.start > Math.max(max, 1)) state.start = max ? 1 : null;
  if (state.end == null || state.end > max) state.end = max || null;

  const percent = stats.wordCount ? Math.round((stats.practiced / stats.wordCount) * 100) : 0;
  const sub = max
    ? `索引 1 – ${max} · 还有 ${Math.max(stats.wordCount - stats.practiced, 0)} 词未练${stats.blockedCount ? ` · 屏蔽 ${stats.blockedCount} 个` : ''}`
    : (stats.blockedCount ? `${stats.blockedCount} 个单词都被屏蔽了，取消屏蔽后才会出现` : '这个词库还没有单词');

  const bookOptions = state.books
    .map((b) => `<option value="${b.id}" ${b.id === state.bookId ? 'selected' : ''}>${esc(b.name)}（${b.wordCount} 词）</option>`)
    .join('');

  const modes = ['en_zh', 'zh_en', 'spell'].map((key) => {
    const info = state.modes[key] || {};
    return `
      <button class="mode ${state.mode === key ? 'on' : ''}" data-action="mode" data-mode="${key}">
        <span class="check">${state.mode === key ? '✓' : ''}</span>
        <span><b>${esc(info.label || key)}</b><small>${esc(info.desc || '')}</small></span>
      </button>`;
  }).join('');

  app.innerHTML = `
    ${topbar()}
    <section class="hero">
      <div class="tag">本词库进度</div>
      <div class="big">已练 ${stats.practiced} / ${stats.wordCount} 词</div>
      <div class="bar"><i style="width:${percent}%"></i></div>
      <div class="sub">${esc(sub)}</div>
    </section>

    <div class="home-grid" style="margin-top:20px">
      <div class="stack">
        <div class="card book-card">
          <label class="hint" for="bookSelect">词库</label>
          <select id="bookSelect" class="field">${bookOptions}</select>
          <div class="row" style="margin-top:12px">
            <div class="meta">共 ${book.wordCount} 词${book.blockedCount ? ` · 屏蔽 ${book.blockedCount}` : ''}</div>
            <button class="btn text small" data-action="list">词表</button>
            <button class="btn text small" data-action="books">词库管理</button>
          </div>
        </div>

        <div class="card">
          <div class="hint" style="margin-bottom:10px">练习方式</div>
          <div class="mode-list">${modes}</div>
        </div>
      </div>

      <div class="stack">
        <div class="card settings">
          <div class="line">
            <div><div class="title">每次题量</div><small>1 – 200 题</small></div>
            <input id="countInput" class="input narrow" type="number" min="1" max="200" value="${state.count}">
          </div>
          <div class="divider"></div>
          <div class="title">练习范围（词库索引）</div>
          <div class="hint">${max ? `可填 1 – ${max}；留空表示整本词库` : '没有可输入的索引'}</div>
          <div class="range-row" style="margin-top:8px">
            <input id="startInput" class="input" type="number" min="1" placeholder="起始" value="${state.start ?? ''}">
            <input id="endInput" class="input" type="number" min="1" placeholder="结束" value="${state.end ?? ''}">
          </div>
          <label class="checkbox">
            <input id="repeatInput" type="checkbox" ${state.allowRepeat ? 'checked' : ''}>
            允许重复抽到已练过的单词
          </label>
        </div>

        <button class="btn block" data-action="start" ${max ? '' : 'disabled'}>开始练习</button>

        <div class="footer-actions">
          <button class="btn ghost" data-action="list-starred">星标词汇</button>
          <button class="btn ghost" data-action="list-mistakes">错题本</button>
        </div>

        <div style="text-align:center">
          <button class="btn text small" data-action="clear-log">清空练习记录</button>
        </div>
      </div>
    </div>`;
}

/* ---------- 练习 ---------- */

function readSettings() {
  const count = Number(document.getElementById('countInput').value) || 0;
  const startRaw = document.getElementById('startInput').value.trim();
  const endRaw = document.getElementById('endInput').value.trim();
  const max = state.stats && state.stats.range ? state.stats.range.end : 0;
  const start = startRaw === '' ? 1 : Number(startRaw);
  const end = endRaw === '' ? max : Number(endRaw);
  if (count < 1 || count > 200) throw new Error('题量请填 1 – 200');
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 1 || end > max || start > end) {
    throw new Error(`索引范围应在 1 – ${max} 之间，且起始不大于结束`);
  }
  state.count = count;
  state.start = start;
  state.end = end;
  state.allowRepeat = document.getElementById('repeatInput').checked;
  return { count, start, end, allowRepeat: state.allowRepeat };
}

async function startPractice(settings, wordIds = null, filter = 'all') {
  const book = currentBook();
  if (!book) return;
  const payload = {
    bookId: book.id,
    mode: state.mode,
    count: wordIds ? wordIds.length : settings.count,
    start: settings.start,
    end: settings.end,
    allowRepeat: wordIds ? true : settings.allowRepeat,
    filter,
  };
  if (wordIds) payload.wordIds = wordIds;
  const data = await api('/api/practice/start', { method: 'POST', body: payload });
  if (!data.items.length) {
    toast(wordIds ? '没有可练习的单词' : '当前词库或范围里没有单词');
    return;
  }
  state.practice = {
    items: data.items,
    index: 0,
    answered: false,
    choice: null,
    input: '',
    records: [],
    mode: data.mode,
    bookName: data.bookName,
    requested: data.requested,
  };
  if (data.items.length < data.requested) toast(`可抽的单词不足，本轮只有 ${data.items.length} 题`);
  location.hash = '#/practice';
}

async function startPracticeFromHome() {
  try {
    const settings = readSettings();
    await startPractice(settings);
  } catch (err) {
    toast(err.message);
  }
}

function renderPractice() {
  const p = state.practice;
  if (!p) { location.hash = '#/'; return; }
  const item = p.items[p.index];
  const total = p.items.length;
  const percent = Math.round(((p.index + (p.answered ? 1 : 0)) / total) * 100);
  const isSpell = item.spell;

  let body;
  if (isSpell) {
    const disabled = p.answered ? 'disabled' : '';
    body = `
      <div class="spell-box">
        <div class="spell-hint">${esc(item.hint)}　(${item.answer.length} 个字母)</div>
        <input id="spellInput" class="input" autocomplete="off" autocapitalize="off" spellcheck="false"
               placeholder="输入英文，回车提交" value="${esc(p.input)}" ${disabled}>
        ${p.answered ? '' : '<button class="btn block" style="margin-top:10px" data-action="submit-spell">提交</button>'}
      </div>`;
  } else {
    body = `
      <div class="options">
        ${item.options.map((text, index) => {
    const cls = p.answered
      ? (index === item.correctOption ? 'correct' : (index === p.choice ? 'wrong' : ''))
      : '';
    return `
          <button class="opt ${cls}" data-action="option" data-index="${index}" ${p.answered ? 'disabled' : ''}>
            <span class="badge">${String.fromCharCode(65 + index)}</span>
            <span>${esc(text)}</span>
          </button>`;
  }).join('')}
      </div>`;
  }

  const feedback = p.answered ? renderFeedback(item) : '';
  const nextButton = p.answered
    ? `<button class="btn block" data-action="next">${p.index + 1 >= total ? '查看结果' : '下一题（Enter）'}</button>`
    : '';

  app.innerHTML = `
    <div class="center-col">
      ${pageHead(`${modeLabel(p.mode)} · ${p.bookName}`, `
        <button class="icon-btn ${item.starred ? 'star-on' : ''}" data-action="star" title="星标">${item.starred ? '★' : '☆'}</button>
        <button class="icon-btn" data-action="exit" title="退出练习">✕</button>`)}
      <div class="practice-top">
        <div class="progress-text">第 ${p.index + 1} 题 / 共 ${total} 题</div>
        <div class="bar on-light" style="flex:1;margin-top:0"><i style="width:${percent}%"></i></div>
      </div>

      <div class="prompt-card">
        <div class="prompt-label">${isSpell || p.mode === 'zh_en' ? '中 文 释 义' : '英 文'}</div>
        <div class="prompt">${esc(item.prompt)}</div>
      </div>

      ${body}
      ${feedback}
      <div class="practice-actions">${nextButton}</div>
      <div class="kbd-tip">按 <kbd>1</kbd>–<kbd>4</kbd> 或 <kbd>A</kbd>–<kbd>D</kbd> 选择，<kbd>Enter</kbd> 下一题${isSpell ? '，<kbd>Enter</kbd> 提交拼写' : ''}</div>
    </div>`;

  if (isSpell && !p.answered) {
    const input = document.getElementById('spellInput');
    input.focus();
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        submitSpell();
      }
    });
    input.addEventListener('input', () => { p.input = input.value; });
  }
}

function renderFeedback(item) {
  const record = state.practice.records[state.practice.records.length - 1];
  const ok = record && record.correct;
  const text = ok
    ? `✓ 答对了\n${item.word} — ${item.meaning}`
    : `✗ 正确答案：${item.answer}\n你作答的是：${record ? record.userAnswer : ''}\n${item.word} — ${item.meaning}`;
  return `<div class="feedback ${ok ? 'ok' : 'no'}">${esc(text)}</div>`;
}

async function answerOption(index) {
  const p = state.practice;
  if (!p || p.answered) return;
  const item = p.items[p.index];
  p.answered = true;
  p.choice = index;
  const correct = index === item.correctOption;
  const userAnswer = item.options[index] || '';
  p.records.push({
    wordId: item.wordId, word: item.word, meaning: item.meaning,
    answer: item.answer, userAnswer, correct,
  });
  renderPractice();
  try {
    await api('/api/practice/answer', { method: 'POST', body: { wordId: item.wordId, mode: p.mode, correct } });
  } catch (err) {
    toast(err.message);
  }
}

async function submitSpell() {
  const p = state.practice;
  if (!p || p.answered) return;
  const item = p.items[p.index];
  const input = (document.getElementById('spellInput') || {}).value || p.input || '';
  if (!input.trim()) { toast('先输入你记得的英文'); return; }
  const normalize = (s) => String(s).trim().toLowerCase().replace(/\s+/g, ' ');
  const correct = normalize(input) !== '' && normalize(input) === normalize(item.answer);
  p.answered = true;
  p.input = input;
  p.records.push({
    wordId: item.wordId, word: item.word, meaning: item.meaning,
    answer: item.answer, userAnswer: input, correct,
  });
  renderPractice();
  try {
    await api('/api/practice/answer', { method: 'POST', body: { wordId: item.wordId, mode: p.mode, correct } });
  } catch (err) {
    toast(err.message);
  }
}

function nextQuestion() {
  const p = state.practice;
  if (!p) return;
  p.index += 1;
  p.answered = false;
  p.choice = null;
  p.input = '';
  if (p.index >= p.items.length) {
    state.result = { mode: p.mode, bookName: p.bookName, records: p.records };
    state.practice = null;
    location.hash = '#/result';
    return;
  }
  renderPractice();
}

async function toggleStar() {
  const p = state.practice;
  if (!p) return;
  const item = p.items[p.index];
  const starred = !item.starred;
  try {
    await api(`/api/words/${item.wordId}/star`, { method: 'POST', body: { starred } });
    item.starred = starred;
    renderPractice();
    toast(starred ? '已加星标' : '已取消星标');
  } catch (err) {
    toast(err.message);
  }
}

function exitPractice() {
  const p = state.practice;
  if (!p || p.records.length === 0) {
    state.practice = null;
    location.hash = '#/';
    return;
  }
  confirmDialog('退出练习？', `已答的 ${p.records.length} 道题会记入错题与练习记录。`, '退出').then((ok) => {
    if (!ok) return;
    state.practice = null;
    location.hash = '#/';
  });
}

/* ---------- 结果 ---------- */

function renderResult() {
  const result = state.result;
  if (!result) { location.hash = '#/'; return; }
  const total = result.records.length;
  const correct = result.records.filter((r) => r.correct).length;
  const percent = total ? Math.round((correct * 100) / total) : 0;
  const wrong = result.records.filter((r) => !r.correct);

  app.innerHTML = `
    <div class="center-col">
      ${pageHead('练习结果')}
      <div class="card result-card">
        <div class="score">${percent}%</div>
        <div class="result-detail">答对 ${correct} / ${total} 题 · ${esc(modeLabel(result.mode))} · ${esc(result.bookName)}</div>
        <div class="bar on-light" style="margin-top:16px"><i style="width:${percent}%"></i></div>
      </div>

      <div class="wrong-label">${wrong.length ? `错题 ${wrong.length}` : '全部答对，没有错题'}</div>
      ${wrong.map((r) => `
        <div class="wrong-item">
          <b>${esc(r.word)}</b>
          <div class="m">${esc(r.meaning)}</div>
          <div class="a">你的答案：${esc(r.userAnswer)}　正确答案：${esc(r.answer)}</div>
        </div>`).join('')}

      <div class="footer-actions" style="margin-top:20px">
        ${wrong.length ? '<button class="btn" data-action="retry-wrong">重练错题</button>' : ''}
        <button class="btn ghost" data-action="done">完成</button>
      </div>
    </div>`;
}

async function retryWrong() {
  const result = state.result;
  if (!result) return;
  const ids = result.records.filter((r) => !r.correct).map((r) => r.wordId);
  if (!ids.length) return;
  state.mode = result.mode;
  await startPractice({ count: ids.length, start: 1, end: Number.MAX_SAFE_INTEGER, allowRepeat: true }, ids);
}

/* ---------- 词表 ---------- */

async function renderList() {
  const book = currentBook();
  if (!book) { location.hash = '#/'; return; }
  const filter = state.listFilter;
  const data = await loadListData(book, filter);
  state.listData = data;
  const title = filter === 'blocked' ? '已屏蔽单词' : '词表';

  app.innerHTML = `
    <div class="center-col wide">
      ${pageHead(title, `
        ${filter === 'all' && !book.builtin && book.blockedCount ? `<button class="btn text small" data-action="show-blocked">已屏蔽（${book.blockedCount}）</button>` : ''}
        ${filter === 'blocked' ? '<button class="btn text small" data-action="show-all">返回词表</button>' : ''}
        ${filter === 'all' && !book.builtin ? `<button class="btn text small" data-action="append">追加单词</button>` : ''}
        ${filter === 'blocked' && data.words.length ? '<button class="btn text small" data-action="unblock-all">全部恢复</button>' : ''}
        ${filter === 'mistakes' ? '<button class="btn text small" data-action="clear-mistakes">清空错题</button>' : ''}`)}
      <div class="toolbar-row">
        <input id="searchInput" class="search" placeholder="搜索单词或释义" value="${esc(state.search)}">
      </div>
      <div class="list-meta" id="listMeta">${listMetaText(filter, data, book)}</div>
      <div id="listRows">${listRowsHtml(data, filter, book)}</div>
      <div class="footer-actions" style="margin-top:16px">
        ${filter === 'blocked' ? '' : `<button class="btn block" data-action="practice-list">练习这些单词</button>`}
      </div>
    </div>`;

  const search = document.getElementById('searchInput');
  search.addEventListener('input', () => {
    state.search = search.value;
    clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(async () => {
      const fresh = await loadListData(currentBook(), filter);
      state.listData = fresh;
      document.getElementById('listRows').innerHTML = listRowsHtml(fresh, filter, currentBook());
      document.getElementById('listMeta').textContent = listMetaText(filter, fresh, currentBook());
    }, 220);
  });
}

async function loadListData(book, filter) {
  if (!book) return { words: [], counts: {} };
  if (filter === 'mistakes') {
    return api(`/api/books/${book.id}/mistakes`);
  }
  const q = encodeURIComponent(state.search || '');
  const data = await api(`/api/books/${book.id}/words?filter=${filter}&q=${q}`);
  return { words: data.words, counts: {} };
}

function listMetaText(filter, data, book) {
  if (filter === 'blocked') {
    return data.words.length ? `共 ${data.words.length} 个已屏蔽单词 · 点击「恢复」放回词表` : '还没有屏蔽任何单词';
  }
  const blocked = book && book.blockedCount ? ` · 屏蔽 ${book.blockedCount} 个` : '';
  return `共 ${data.words.length} 个单词${blocked}${filter === 'all' && !book.builtin ? ' · 行尾可屏蔽' : ''}`;
}

function listRowsHtml(data, filter, book) {
  if (!data.words.length) {
    return `<div class="empty">${filter === 'mistakes' ? '还没有错题' : '没有单词'}</div>`;
  }
  return data.words.map((word) => {
    const extra = data.counts[word.id] ? `<div class="extra">错 ${data.counts[word.id]} 次</div>` : '';
    return `
      <div class="word-row">
        <div class="idx">${word.index == null ? '' : word.index}</div>
        <div class="body">
          <div class="w">${esc(word.word)}</div>
          <div class="m">${esc(word.pos ? `${word.pos} ${word.meaning}` : word.meaning)}</div>
          ${extra}
        </div>
        <div class="acts">
          <button class="icon-btn ${word.starred ? 'star-on' : ''}" data-action="row-star" data-id="${word.id}" title="星标">${word.starred ? '★' : '☆'}</button>
          ${filter === 'blocked' ? `<button class="btn small ghost" data-action="row-unblock" data-id="${word.id}">恢复</button>`
    : (filter === 'all' && !book.builtin ? `<button class="btn small ghost" data-action="row-block" data-id="${word.id}">屏蔽</button>` : '')}
        </div>
      </div>`;
  }).join('');
}

async function practiceList() {
  const book = currentBook();
  if (!book) return;
  const data = state.listData || await loadListData(book, state.listFilter);
  const ids = data.words.map((w) => w.id);
  if (!ids.length) { toast('还没有可练习的单词'); return; }
  const filter = state.listFilter === 'mistakes' ? 'mistakes' : (state.listFilter === 'starred' ? 'starred' : 'all');
  const chosen = await chooseCount(ids.length);
  if (!chosen) return;
  await startPractice(
    { count: chosen, start: 1, end: Number.MAX_SAFE_INTEGER, allowRepeat: true },
    chosen >= ids.length ? ids : ids.slice(0, chosen),
    filter,
  );
}

async function listRowAction(action, id) {
  const word = (state.listData && state.listData.words.find((w) => w.id === id)) || null;
  try {
    if (action === 'row-star') {
      const starred = !(word && word.starred);
      await api(`/api/words/${id}/star`, { method: 'POST', body: { starred } });
      await renderList();
      return;
    }
    if (action === 'row-block') {
      await api(`/api/words/${id}/block`, { method: 'POST', body: { blocked: true } });
      toast(`已屏蔽 ${word ? word.word : ''}`);
      await reloadBooks();
      await renderList();
      return;
    }
    if (action === 'row-unblock') {
      await api(`/api/words/${id}/block`, { method: 'POST', body: { blocked: false } });
      toast(`已恢复 ${word ? word.word : ''}`);
      await reloadBooks();
      await renderList();
    }
  } catch (err) {
    toast(err.message);
  }
}

async function refreshList() {
  const book = currentBook();
  if (!book) return;
  const data = await loadListData(book, state.listFilter);
  state.listData = data;
  const rows = document.getElementById('listRows');
  const meta = document.getElementById('listMeta');
  if (rows) rows.innerHTML = listRowsHtml(data, state.listFilter, book);
  if (meta) meta.textContent = listMetaText(state.listFilter, data, book);
  const practiceBtn = document.querySelector('[data-action="practice-list"]');
  if (practiceBtn) practiceBtn.disabled = data.words.length === 0;
}

/* ---------- 词库管理 ---------- */

async function renderBooks() {
  await reloadBooks();
  app.innerHTML = `
    <div class="center-col wide">
      ${pageHead('词库管理', '<button class="btn small" data-action="import-new">导入词库</button>')}
      ${state.books.map((book) => `
        <div class="word-row">
          <div class="body">
            <div class="w">${esc(book.name)} ${book.builtin ? '<span class="chip">内置</span>' : ''}</div>
            <div class="m">共 ${book.wordCount} 词${book.blockedCount ? ` · 屏蔽 ${book.blockedCount}` : ''}</div>
          </div>
          <div class="acts" style="opacity:1">
            <button class="btn small ghost" data-action="open-book" data-id="${book.id}">打开</button>
            ${book.builtin ? '' : `<button class="btn small danger" data-action="delete-book" data-id="${book.id}">删除</button>`}
          </div>
        </div>`).join('')}
    </div>`;
}

async function reloadBooks() {
  const data = await api('/api/bootstrap');
  state.books = data.books;
  if (!state.books.some((b) => b.id === state.bookId)) {
    state.bookId = state.books[0] ? state.books[0].id : null;
  }
}

async function deleteBook(id) {
  const book = state.books.find((b) => b.id === id);
  if (!book) return;
  const ok = await confirmDialog('删除词库？', `「${book.name}」里的 ${book.wordCount} 个单词会一起删除，无法恢复。`, '删除');
  if (!ok) return;
  try {
    await api(`/api/books/${id}`, { method: 'DELETE' });
    await reloadBooks();
    toast('已删除');
    renderBooks();
  } catch (err) {
    toast(err.message);
  }
}

/* ---------- 导入 ---------- */

async function renderImport() {
  const book = state.importBookId ? await api(`/api/books/${state.importBookId}/stats`) : null;
  const appending = Boolean(book);
  app.innerHTML = `
    ${pageHead(appending ? '追加单词' : '导入词汇表')}
    <div class="center-col">
      <div class="card">
        <label class="hint" for="nameInput">词库名称</label>
        <input id="nameInput" class="input" value="${appending ? esc(book.name) : ''}" ${appending ? 'disabled' : ''} placeholder="例如：必修一 Unit 3">

        <div class="divider"></div>

        <div id="dropZone" class="drop">
          <b>把 Markdown / 文本文件拖到这里</b>
          <span>或点击选择文件（.md / .txt，自动识别 UTF-8 / GBK）</span>
          <input id="fileInput" type="file" accept=".md,.markdown,.txt,text/plain" hidden>
        </div>
        <div id="fileName" class="hint" style="margin-top:8px"></div>

        <div class="divider"></div>

        <div class="hint" style="margin-bottom:8px">或者直接粘贴表格内容（支持三列 / 四列，序号会被忽略）</div>
        <textarea id="markdownInput" class="input" placeholder="| 英文 | 词性 | 汉语 |
|---|---|---|
| competence | n. | 能力；胜任 |"></textarea>

        <div class="preview" id="preview" hidden></div>

        <div class="footer-actions">
          <button class="btn ghost" data-action="preview">解析预览</button>
          <button class="btn" data-action="save-import">保存导入</button>
        </div>
      </div>
    </div>`;

  const drop = document.getElementById('dropZone');
  const fileInput = document.getElementById('fileInput');
  drop.addEventListener('click', () => fileInput.click());
  drop.addEventListener('dragover', (event) => { event.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (event) => {
    event.preventDefault();
    drop.classList.remove('over');
    if (event.dataTransfer.files[0]) handleFile(event.dataTransfer.files[0]);
  });
  fileInput.addEventListener('change', () => { if (fileInput.files[0]) handleFile(fileInput.files[0]); });

  document.getElementById('markdownInput').addEventListener('input', () => {
    importEntries = [];
    const preview = document.getElementById('preview');
    if (preview) preview.hidden = true;
  });
}

let importEntries = [];

async function handleFile(file) {
  if (file.size > 4 * 1024 * 1024) { toast('文件超过 4 MB，请拆分后再导入'); return; }
  const buffer = await file.arrayBuffer();
  const base64 = base64FromBytes(new Uint8Array(buffer));
  try {
    const data = await api('/api/parse', { method: 'POST', body: { base64 } });
    importEntries = data.entries;
    document.getElementById('markdownInput').value = '';
    document.getElementById('fileName').textContent = `已读取：${file.name}（${data.total} 条）`;
    showPreview(data);
    if (!state.importBookId) {
      const nameInput = document.getElementById('nameInput');
      if (!nameInput.value.trim()) nameInput.value = file.name.replace(/\.[^.]+$/, '');
    }
  } catch (err) {
    toast(err.message);
  }
}

function base64FromBytes(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function showPreview(data) {
  const preview = document.getElementById('preview');
  if (!preview) return;
  preview.hidden = false;
  if (!data.entries.length) {
    preview.textContent = '没有解析到单词。请确认内容是 Markdown 表格（| 英文 | 词性 | 汉语 |）。';
    return;
  }
  const sample = data.entries.slice(0, 5)
    .map((e) => `· ${e.word}  ${e.pos}  ${e.meaning}`)
    .join('\n');
  const more = data.entries.length > 5 ? '\n…' : '';
  preview.textContent = `解析到 ${data.total} 条（按出现顺序入库）：\n${sample}${more}`;
}

async function previewImport() {
  const text = document.getElementById('markdownInput').value;
  if (!text.trim()) { toast('先选择文件或粘贴表格'); return; }
  try {
    const base64 = base64FromBytes(new TextEncoder().encode(text));
    const data = await api('/api/parse', { method: 'POST', body: { base64 } });
    importEntries = data.entries;
    showPreview(data);
  } catch (err) {
    toast(err.message);
  }
}

async function saveImport() {
  if (state.importBookId) {
    if (!importEntries.length) { await previewImport(); }
    if (!importEntries.length) { toast('没有可导入的单词'); return; }
    try {
      const result = await api(`/api/books/${state.importBookId}/import`, { method: 'POST', body: { entries: importEntries } });
      toast(`已追加 ${result.added} 条，跳过 ${result.skipped} 条重复`);
      state.importBookId = null;
      await reloadBooks();
      location.hash = '#/list';
    } catch (err) {
      toast(err.message);
    }
    return;
  }

  const name = document.getElementById('nameInput').value.trim();
  if (!name) { toast('请填写词库名称'); return; }
  if (!importEntries.length) { await previewImport(); }
  if (!importEntries.length) { toast('没有可导入的单词'); return; }
  try {
    const result = await api('/api/books', { method: 'POST', body: { name, entries: importEntries } });
    toast(`已创建「${name}」，导入 ${result.added} 条`);
    await reloadBooks();
    state.bookId = result.bookId;
    location.hash = '#/';
  } catch (err) {
    toast(err.message);
  }
}

/* ---------- 对话框 ---------- */

function confirmDialog(title, message, okLabel) {
  return new Promise((resolve) => {
    const overlay = openModal(`
      <div class="about-card" style="text-align:left">
        <h3 style="margin-top:0">${esc(title)}</h3>
        <p style="color:var(--muted);font-size:13.5px">${esc(message)}</p>
        <div class="footer-actions" style="margin-top:18px">
          <button class="btn ghost" data-close>取消</button>
          <button class="btn" data-ok>${esc(okLabel || '确定')}</button>
        </div>
      </div>`);
    overlay.querySelector('[data-ok]').addEventListener('click', () => { overlay.remove(); resolve(true); });
    overlay.querySelector('[data-close]').addEventListener('click', () => { overlay.remove(); resolve(false); });
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) { overlay.remove(); resolve(false); }
    });
  });
}

function chooseCount(total) {
  return new Promise((resolve) => {
    const options = [10, 20, total].filter((n, i, arr) => n <= total && arr.indexOf(n) === i);
    const overlay = openModal(`
      <div class="about-card" style="text-align:left">
        <h3 style="margin-top:0">本轮题量</h3>
        <div class="mode-list">
          ${options.map((n) => `<button class="mode" data-count="${n}">
            <span><b>${n >= total ? `全部（${total} 题）` : `${n} 题`}</b></span></button>`).join('')}
        </div>
      </div>`);
    overlay.querySelectorAll('[data-count]').forEach((button) => {
      button.addEventListener('click', () => {
        const value = Number(button.dataset.count);
        overlay.remove();
        resolve(value);
      });
    });
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) { overlay.remove(); resolve(0); }
    });
  });
}

function showAbout() {
  const info = state.about || {};
  const rows = [];
  if (info.developer) rows.push({ label: '开发者', value: info.developer });
  (info.rows || []).forEach((row) => rows.push(row));
  openModal(`
    <div class="about-card">
      <img class="logo" src="/icon.png" alt="">
      <h3>${esc(info.name || '单词练习')}</h3>
      <div class="ver">版本 ${esc(info.version || '1.0.0')}</div>
      <div class="sum">${esc(info.summary || '')}</div>
      ${rows.length ? `<div class="about-rows">
        ${rows.map((row) => `<div class="about-row">
          ${row.label ? `<span class="k">${esc(row.label)}</span>` : ''}
          <span class="v">${esc(row.value)}</span>
        </div>`).join('')}
      </div>` : ''}
      ${info.note ? `<div class="about-note">${esc(info.note)}</div>` : ''}
      <button class="btn ghost about-close" data-close>知道了</button>
    </div>`);
}

/* ---------- 事件 ---------- */

app.addEventListener('click', async (event) => {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  const action = target.dataset.action;

  switch (action) {
    case 'home':
      location.hash = '#/';
      break;
    case 'about':
      showAbout();
      break;
    case 'mode':
      state.mode = target.dataset.mode;
      localStorage.setItem('worddrill.mode', state.mode);
      await renderHome();
      break;
    case 'start':
      await startPracticeFromHome();
      break;
    case 'list':
      state.listFilter = 'all';
      location.hash = '#/list';
      break;
    case 'list-starred':
      state.listFilter = 'starred';
      location.hash = '#/list';
      break;
    case 'list-mistakes':
      state.listFilter = 'mistakes';
      location.hash = '#/list';
      break;
    case 'books':
      location.hash = '#/books';
      break;
    case 'import-new':
      state.importBookId = null;
      importEntries = [];
      location.hash = '#/import';
      break;
    case 'append':
      state.importBookId = state.bookId;
      importEntries = [];
      location.hash = '#/import';
      break;
    case 'preview':
      await previewImport();
      break;
    case 'save-import':
      await saveImport();
      break;
    case 'option':
      await answerOption(Number(target.dataset.index));
      break;
    case 'submit-spell':
      await submitSpell();
      break;
    case 'next':
      nextQuestion();
      break;
    case 'star':
      await toggleStar();
      break;
    case 'exit':
      exitPractice();
      break;
    case 'retry-wrong':
      await retryWrong();
      break;
    case 'done':
      state.result = null;
      location.hash = '#/';
      break;
    case 'practice-list':
      await practiceList();
      break;
    case 'row-star':
    case 'row-block':
    case 'row-unblock':
      await listRowAction(action, Number(target.dataset.id));
      break;
    case 'show-blocked':
      state.listFilter = 'blocked';
      await renderList();
      break;
    case 'show-all':
      state.listFilter = 'all';
      await renderList();
      break;
    case 'unblock-all': {
      const book = currentBook();
      const ok = await confirmDialog('恢复全部屏蔽单词？', `会把「${book.name}」里被屏蔽的单词全部恢复。`, '全部恢复');
      if (!ok) return;
      try {
        await api(`/api/books/${book.id}/unblock-all`, { method: 'POST' });
        await reloadBooks();
        await refreshList();
        toast('已全部恢复');
      } catch (err) { toast(err.message); }
      break;
    }
    case 'clear-mistakes': {
      const book = currentBook();
      const ok = await confirmDialog('清空错题本？', `会把「${book.name}」的错题记录全部删除，星标不受影响。`, '清空');
      if (!ok) return;
      try {
        await api(`/api/books/${book.id}/clear-mistakes`, { method: 'POST' });
        await renderList();
        toast('已清空错题本');
      } catch (err) { toast(err.message); }
      break;
    }
    case 'clear-log': {
      const ok = await confirmDialog('清空练习记录？', '清空后所有单词都会重新被视为「没练过」，星标和错题不受影响。', '清空');
      if (!ok) return;
      try {
        await api('/api/practice/clear-log', { method: 'POST' });
        await renderHome();
        toast('已清空练习记录');
      } catch (err) { toast(err.message); }
      break;
    }
    case 'open-book':
      state.bookId = Number(target.dataset.id);
      localStorage.setItem('worddrill.bookId', state.bookId);
      location.hash = '#/list';
      break;
    case 'delete-book':
      await deleteBook(Number(target.dataset.id));
      break;
    default:
      break;
  }
});

app.addEventListener('change', (event) => {
  if (event.target.id === 'bookSelect') {
    state.bookId = Number(event.target.value);
    state.start = null;
    state.end = null;
    localStorage.setItem('worddrill.bookId', state.bookId);
    renderHome();
  }
});

/* 首页输入即时保存，换模式/重绘不丢 */
app.addEventListener('input', (event) => {
  if (event.target.id === 'countInput') state.count = Number(event.target.value) || 0;
  if (event.target.id === 'startInput') state.start = Number(event.target.value) || null;
  if (event.target.id === 'endInput') state.end = Number(event.target.value) || null;
});
app.addEventListener('change', (event) => {
  if (event.target.id === 'repeatInput') state.allowRepeat = event.target.checked;
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    const modal = document.querySelector('.modal');
    if (modal) { modal.remove(); return; }
  }
  const p = state.practice;
  if (!p || !location.hash.startsWith('#/practice')) return;
  const typing = event.target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName);

  if (/^[1-4]$/.test(event.key) && !p.answered && !typing) {
    answerOption(Number(event.key) - 1);
    return;
  }
  if (/^[a-dA-D]$/.test(event.key) && !p.answered && !typing) {
    answerOption(event.key.toLowerCase().charCodeAt(0) - 97);
    return;
  }
  if (event.key === 'Enter' && p.answered) {
    event.preventDefault();
    nextQuestion();
  }
});

/* 启动 */
boot().catch((err) => {
  app.innerHTML = `<div class="card" style="margin-top:60px">
    <h2>启动失败</h2><p>${esc(err.message)}</p>
    <p class="hint">确认服务已经启动：node server.js</p></div>`;
});
