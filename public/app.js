import * as repo from './js/repo.js';
import { richText } from './js/about.js';
import * as settings from './js/settings.js';
import { speak, supported as speechSupported, warmup as warmupSpeech } from './js/speech.js';
import { applyTheme, themePref, setThemePref, watchSystem } from './js/theme.js';
import { mistakesCsv, csvFileName, CSV_BOM } from './js/csv.js';

/* ============================================================
 * 单词练习 · 前端（纯静态版，数据存在浏览器里）
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
  stats: null,
  practice: null,
  result: null,
  listFilter: 'all',
  studiedFilter: 'all',
  mistakeSort: 'recent',
  listLimit: 200,
  search: '',
  importBookId: null,
  searchTimer: null,
};

const currentBook = () => state.books.find((b) => b.id === state.bookId) || null;
const modeLabel = (key) => (state.modes[key] || {}).label || '练习';

/* 界面偏好（上次选的词库 / 练习方式），和词库数据分开存 */
const prefs = {
  get(key, fallback = '') {
    try {
      const value = localStorage.getItem(key);
      return value == null ? fallback : value;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try { localStorage.setItem(key, String(value)); } catch { /* 忽略 */ }
  },
};

/* ---------- 路由 ---------- */

async function boot() {
  applyTheme();
  watchSystem();
  warmupSpeech();
  const data = await repo.init({ onStorageError: (err) => toast(`保存失败：${err.message}`) });
  state.books = data.books;
  state.modes = data.modes;
  state.about = data.about;
  const saved = Number(prefs.get('worddrill.bookId', 0));
  const found = state.books.find((b) => b.id === saved);
  state.bookId = found ? found.id : (state.books[0] ? state.books[0].id : null);
  const savedMode = prefs.get('worddrill.mode');
  if (savedMode && state.modes[savedMode]) state.mode = savedMode;
  await route();
  afterBoot();
}

function afterBoot() {
  keepStorage();
  registerServiceWorker();
}

/* 申请「持久化存储」，降低浏览器在空间紧张时清掉数据的概率 */
async function keepStorage() {
  try {
    if (navigator.storage && navigator.storage.persist && !(await navigator.storage.persisted())) {
      await navigator.storage.persist();
    }
  } catch {
    /* 不支持就算了 */
  }
}

/* 页面隐藏或关闭前，把还在防抖里的写入落盘 */
for (const event of ['pagehide', 'visibilitychange', 'beforeunload']) {
  window.addEventListener(event, () => {
    if (event !== 'visibilitychange' || document.visibilityState === 'hidden') repo.flush();
  });
}

async function route() {
  const hash = location.hash.replace(/^#\/?/, '');
  const [name] = hash.split('/');
  // 页面级样式钩子，每次路由先清掉，避免残留
  app.classList.remove('on-report');
  app.classList.toggle('no-sidenav', name === 'practice' || name === 'result');
  renderSidenav(name);
  try {
    if (name === 'practice') return renderPractice();
    if (name === 'result') return renderResult();
    if (name === 'list') return renderList();
    if (name === 'starred') { state.listFilter = 'starred'; return renderList(); }
    if (name === 'mistakes') { state.listFilter = 'mistakes'; return renderList(); }
    if (name === 'books') return renderBooks();
    if (name === 'import') return renderImport();
    if (name === 'studied') return renderStudied();
    if (name === 'report') return renderReport();
    if (name === 'settings') return renderSettings();
    if (name === 'privacy') return renderPrivacy();
    return renderHome();
  } catch (err) {
    app.innerHTML = `${topbar()}<div class="card"><p>出错了：${esc(err.message)}</p>
      <button class="btn" data-action="home">回到首页</button></div>`;
  }
}

window.addEventListener('hashchange', () => { route(); });

/* ---------- 通用片段 ---------- */

/** 移动端导航开关：标题左侧三个点。桌面端由 CSS 隐藏。 */
function navToggleHtml() {
  return `
    <button class="icon-btn nav-toggle" data-action="open-nav" type="button"
            title="导航" aria-label="打开导航" aria-expanded="false">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="5.4" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="12" cy="18.6" r="1.7"/>
      </svg>
    </button>`;
}

function topbar() {
  return `
    <header class="topbar">
      ${navToggleHtml()}
      <h1>单词练习</h1>
    </header>`;
}

/* ---------- 侧边导航（桌面端） ---------- */

const NAV_ITEMS = [
  { hash: '#/', label: '单词练习', icon: 'book' },
  { hash: '#/starred', label: '星标词汇', icon: 'star' },
  { hash: '#/studied', label: '已练词汇', icon: 'check' },
  { hash: '#/mistakes', label: '错题本', icon: 'wrong' },
  { hash: '#/report', label: '学习报告', icon: 'chart' },
  { hash: '#/settings', label: '设置', icon: 'gear' },
];

const NAV_ICONS = {
  book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H19v15H6.5A2.5 2.5 0 0 0 4 20.5V5.5Z"/><path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H19"/>',
  star: '<path d="M12 3.4l2.7 5.5 6 .9-4.35 4.24 1.03 6L12 17.2l-5.38 2.84 1.03-6L3.3 9.8l6-.9L12 3.4Z"/>',
  check: '<circle cx="12" cy="12" r="8.4"/><path d="M8.2 12.2l2.6 2.6 5-5.2"/>',
  wrong: '<circle cx="12" cy="12" r="8.4"/><path d="M9.2 9.2l5.6 5.6M14.8 9.2l-5.6 5.6"/>',
  chart: '<path d="M4 20V4"/><path d="M4 20h16"/><rect x="7" y="12" width="3" height="5" rx="1"/><rect x="12.5" y="8.5" width="3" height="8.5" rx="1"/><rect x="18" y="5" width="3" height="12" rx="1"/>',
  gear: '<circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1.03-1.56V3a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 15 4.6a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9v0a1.7 1.7 0 0 0 1.56 1.03H21a2 2 0 1 1 0 4h-.09A1.7 1.7 0 0 0 19.4 15Z"/>',
};

/** 当前路由属于哪一个导航项：报告、设置各自独立，其余都算单词练习。 */
function navKeyFor(name) {
  if (name === 'report') return '#/report';
  if (name === 'settings' || name === 'privacy') return '#/settings';
  if (name === 'starred') return '#/starred';
  if (name === 'studied') return '#/studied';
  if (name === 'mistakes') return '#/mistakes';
  return '#/';
}

/** 侧边导航每次渲染一次，只在路由变化时更新高亮。 */
function renderSidenav(name) {
  const nav = document.getElementById('sidenav');
  if (!nav) return;
  if (!nav.dataset.ready) {
    nav.innerHTML = `
      <div class="sidenav-brand">
        <img class="sidenav-logo" src="./icon.png" alt="">
        <span>单词练习</span>
      </div>
      <div class="sidenav-items">
        ${NAV_ITEMS.map((item, i) => `
          <a class="nav-item" href="${item.hash}" data-nav="${item.hash}" style="--i:${i}">
            <svg class="nav-icon" viewBox="0 0 24 24" aria-hidden="true">${NAV_ICONS[item.icon]}</svg>
            <span class="nav-label">${item.label}</span>
            <span class="nav-glow"></span>
          </a>`).join('')}
      </div>`;
    nav.dataset.ready = '1';
  }
  const active = navKeyFor(name);
  nav.querySelectorAll('[data-nav]').forEach((el) => {
    el.classList.toggle('active', el.dataset.nav === active);
  });
}

/* ---------- 移动端导航（标题左侧三点展开） ---------- */

/** 打开手机端导航抽屉。桌面端不显示三点按钮，走不到这里。 */
function openNavDrawer() {
  if (document.querySelector('.nav-drawer')) return;
  const active = navKeyFor(location.hash.replace(/^#\/?/, '').split('/')[0]);
  const overlay = document.createElement('div');
  overlay.className = 'nav-drawer';
  overlay.innerHTML = `
    <div class="nav-sheet" role="dialog" aria-label="导航">
      <div class="nav-sheet-head">
        <img class="sidenav-logo" src="./icon.png" alt="">
        <span>单词练习</span>
        <button class="icon-btn" data-action="close-nav" title="关闭" aria-label="关闭导航">✕</button>
      </div>
      <div class="nav-sheet-items">
        ${NAV_ITEMS.map((item, i) => `
          <a class="nav-item${item.hash === active ? ' active' : ''}" href="${item.hash}" data-nav="${item.hash}" style="--i:${i}">
            <svg class="nav-icon" viewBox="0 0 24 24" aria-hidden="true">${NAV_ICONS[item.icon]}</svg>
            <span class="nav-label">${item.label}</span>
          </a>`).join('')}
      </div>
    </div>`;

  const close = () => {
    overlay.classList.add('closing');
    setTimeout(() => overlay.remove(), 180);
    document.querySelectorAll('[data-action="open-nav"]').forEach((b) => b.setAttribute('aria-expanded', 'false'));
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (event) => { if (event.key === 'Escape') close(); };

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay || event.target.closest('[data-action="close-nav"]')) close();
    const link = event.target.closest('[data-nav]');
    if (link) close();
  });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(overlay);
  document.querySelectorAll('[data-action="open-nav"]').forEach((b) => b.setAttribute('aria-expanded', 'true'));
}

/** 手机端首次打开首页时提示：已支持移动端部署，可在设置里下载 App。 */
function maybeShowMobileTip() {
  if (isStandalone() || prefs.get('worddrill.installTip') === 'off') return;
  if (!isIos() && !isAndroid()) return;
  if (!window.matchMedia('(max-width: 760px)').matches) return;
  if (document.querySelector('.mobile-tip')) return;

  const overlay = openModal(`
    <div class="modal-card mobile-tip" role="dialog" aria-modal="true" aria-labelledby="mobileTipTitle">
      <div class="mobile-tip-icon">
        <img src="./icon.png" alt="">
      </div>
      <h2 id="mobileTipTitle">WordDrill 单词练习</h2>
      <p>现已支持移动端部署</p>
      <div class="mobile-tip-actions">
        <button class="btn" data-close data-action="dismiss-install">了解</button>
      </div>
    </div>`);
  overlay.classList.add('modal-tip');

  /* 弹窗挂在 body 上，app 上的点击委托收不到，这里自己处理 */
  overlay.addEventListener('click', (event) => {
    if (event.target.closest('[data-action="dismiss-install"]')) {
      prefs.set('worddrill.installTip', 'off');
      overlay.remove();
      return;
    }
    if (event.target.closest('[data-action="tip-go-settings"]')) {
      prefs.set('worddrill.installTip', 'off');
      overlay.remove();
      location.hash = '#/settings';
    }
  });
}

/** 手机端首页最下方的安卓 App 下载按钮。APK 地址只在设置页写一次，这里复用。 */
function mobileAppDownloadHtml() {
  const apk = androidApkUrl();
  return `
    <div class="mobile-app-download">
      <a class="btn block apk-btn" href="${apk.url}" target="_blank" rel="noopener">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 3v11m0 0l4-4m-4 4l-4-4M5 20h14"/>
        </svg>
        下载安卓 App（${apk.version}）
      </a>
      <small>APK 安装包 · 可在设置中导入网页数据</small>
    </div>`;
}

/** 太阳 / 月亮 主题开关，和「设置」标题同一行。 */
function themeToggleHtml(pref) {
  const dark = document.documentElement.dataset.theme === 'dark';
  return `
    <button class="theme-switch${dark ? ' is-dark' : ''}" data-action="toggle-theme" type="button"
            role="switch" aria-checked="${dark}" title="${dark ? '切换到浅色' : '切换到深色'}">
      <span class="theme-track">
        <span class="theme-knob">
          <svg class="theme-icon sun" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="4.2"/>
            <path d="M12 2.4v2.2M12 19.4v2.2M2.4 12h2.2M19.4 12h2.2M5.2 5.2l1.6 1.6M17.2 17.2l1.6 1.6M18.8 5.2l-1.6 1.6M6.8 17.2l-1.6 1.6"/>
          </svg>
          <svg class="theme-icon moon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M20.5 14.4A8.6 8.6 0 0 1 9.6 3.5a8.7 8.7 0 1 0 10.9 10.9Z"/>
          </svg>
        </span>
      </span>
    </button>`;
}

function pageHead(title, extra = '', backHash = '#/', navPage = false) {
  return `
    <div class="page-head"${navPage ? ' data-navpage' : ''}>
      ${navToggleHtml()}
      <button class="icon-btn" data-action="back" data-back="${backHash}" title="返回">←</button>
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
  const stats = repo.stats(book.id);
  state.stats = stats;
  let reviewStats = { due: 0, total: 0, overdue: 0, fresh: 0, answeredToday: 0 };
  try { reviewStats = repo.dueReview(0, 'due').stats; } catch { /* 没数据就当 0 */ }
  const due = reviewStats.due;
  const reviewTotal = reviewStats.total;
  const max = stats.range ? stats.range.end : 0;
  if (state.start == null || state.start > Math.max(max, 1)) state.start = max ? 1 : null;
  if (state.end == null || state.end > max) state.end = max || null;

  const percent = stats.wordCount ? Math.round((stats.practiced / stats.wordCount) * 100) : 0;
  const sub = max
    ? `索引 1 – ${max} · 还有 ${stats.fresh} 词未练${stats.learned ? ` · 已掌握 ${stats.learned} 个` : ''}${stats.blockedCount ? ` · 屏蔽 ${stats.blockedCount} 个` : ''}`
    : (stats.blockedCount ? `${stats.blockedCount} 个单词都被屏蔽了，恢复后才会出现` : '这个词库还没有单词');

  const books = state.books || [];

  const modes = Object.keys(state.modes).map((key) => {
    const info = state.modes[key] || {};
    return `
      <button class="mode ${state.mode === key ? 'on' : ''}" data-action="mode" data-mode="${key}">
        <span class="check">${state.mode === key ? '✓' : ''}</span>
        <span><b>${esc(info.label || key)}</b><small>${esc(info.desc || '')}</small></span>
      </button>`;
  }).join('');

  app.innerHTML = `
    <div class="center-col wide home-page">
    ${topbar()}
    <section class="hero">
      <div class="hero-top">
        <div class="tag">本词库进度</div>
        <div class="hero-book">
          <button type="button" class="hero-pick" id="bookPick" aria-haspopup="listbox" aria-expanded="false">
            <span class="hero-pick-name">${esc(book.name)}</span>
            <svg class="book-select-arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
          </button>
          <div class="book-picker" id="bookPicker">
            <div class="book-menu" role="listbox" hidden>
              ${books.map((b) => `
                <button type="button" class="book-option${b.id === book.id ? ' active' : ''}" role="option"
                        aria-selected="${b.id === book.id}" data-book="${b.id}">
                  <span class="book-option-main">
                    <span class="book-option-name">${esc(b.name)}</span>
                    <span class="book-option-meta">${b.wordCount} 词${b.blockedCount ? ` · 屏蔽 ${b.blockedCount}` : ''}</span>
                  </span>
                  <svg class="book-option-check" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>
                </button>`).join('')}
            </div>
          </div>
        </div>
      </div>
      <div class="big">已练 ${stats.practiced} / ${stats.wordCount} 词</div>
      <div class="bar"><i style="width:${percent}%"></i></div>
      <div class="sub">${esc(sub)}</div>
    </section>

    <div class="home-grid" style="margin-top:16px">
      <div class="stack">
        <div class="card">
          <div class="hint" style="margin-bottom:8px">练习方式</div>
          <div class="mode-list">${modes}</div>
        </div>
      </div>

      <div class="stack">
        <button class="btn block start-btn" data-action="start" ${stats.fresh ? '' : 'disabled'}>开始练习</button>
        ${max && !stats.fresh ? '<div class="hint" style="text-align:center;margin-top:-2px">新词都练完了，用下面的「复习」练已练过的词</div>' : ''}

        <button class="btn ghost block review-btn" data-action="review" ${reviewTotal ? '' : 'disabled'}>
          ${reviewTotal
    ? (due ? `复习 ${due} 个单词` : `复习全部练过的 ${reviewTotal} 个单词`)
    : '练过之后就能复习'}
        </button>
        ${reviewTotal
    ? `<div class="hint review-hint">
            ${due ? `今天到期 ${due} 个` : '今天的都复习过了'} · 练过的 ${reviewTotal} 个都能复习
          </div>`

    : ''}

        <div class="card settings start-card">
          <div class="line">
            <div><div class="title">每次题量</div><small>1 – 200 题</small></div>
            <input id="countInput" class="input narrow" type="number" min="1" max="200" value="${state.count}">
          </div>
          <div class="divider"></div>
          <div class="line" style="padding-bottom:0">
            <div><div class="title">练习范围</div><small>${max ? `1 – ${max}，留空为整本` : '没有可输入的索引'}</small></div>
            <div class="range-mini">
              <input id="startInput" class="input narrow" type="number" min="1" placeholder="起" value="${state.start ?? ''}">
              <span>–</span>
              <input id="endInput" class="input narrow" type="number" min="1" placeholder="止" value="${state.end ?? ''}">
            </div>
          </div>
          <div class="divider"></div>
          <div class="hint">每轮只抽从未练过的词。</div>
        </div>

        <div class="row book-links">
          <button class="btn text small" data-action="list">词表</button>
          <button class="btn text small" data-action="books">词库管理</button>
        </div>
      </div>
    </div>
    ${mobileAppDownloadHtml()}
    </div>`;

  bindBookPicker();
  maybeShowMobileTip();
}

/** 首页词库下拉：点开、选中、点外面收起、Esc 收起。 */
function bindBookPicker() {
  const picker = document.getElementById('bookPicker');
  if (!picker) return;
  const trigger = document.getElementById('bookPick');
  const menu = picker.querySelector('.book-menu');
  const wrap = picker.closest('.hero-book') || picker;
  const close = () => {
    menu.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    wrap.classList.remove('open');
    menu.style.top = '';
    menu.style.maxHeight = '';
  };
  const open = () => {
    menu.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    wrap.classList.add('open');
    /* 手机上菜单是 fixed，需要自己算位置：贴在词库按钮下方，下方空间不够就往上弹 */
    if (window.matchMedia('(max-width: 760px)').matches) {
      const rect = trigger.getBoundingClientRect();
      const gap = 6;
      const below = window.innerHeight - rect.bottom - gap - 12;
      const above = rect.top - gap - 12;
      const wanted = 300;
      if (below >= Math.min(wanted, 160) || below >= above) {
        menu.style.top = `${Math.round(rect.bottom + gap)}px`;
        menu.style.maxHeight = `${Math.round(Math.max(below, 120))}px`;
      } else {
        const h = Math.min(wanted, Math.max(above, 120));
        menu.style.top = `${Math.round(rect.top - gap - h)}px`;
        menu.style.maxHeight = `${Math.round(h)}px`;
      }
    }
  };

  trigger.addEventListener('click', (event) => {
    event.stopPropagation();
    if (menu.hidden) open(); else close();
  });

  menu.querySelectorAll('[data-book]').forEach((option) => {
    option.addEventListener('click', () => {
      const id = Number(option.dataset.book);
      close();
      if (id === state.bookId) return;
      state.bookId = id;
      state.start = null;
      state.end = null;
      localStorage.setItem('worddrill.bookId', id);
      renderHome();
    });
  });

  picker.addEventListener('click', (event) => event.stopPropagation());
  document.addEventListener('click', close, { once: true });
  document.addEventListener('keydown', function onKey(event) {
    if (event.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); }
  });
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
  return { count, start, end };
}

async function startPractice(options, wordIds = null, filter = 'all', bookName = null) {
  const book = currentBook();
  if (!book) return;
  const payload = {
    bookId: book.id,
    mode: state.mode,
    count: wordIds ? wordIds.length : options.count,
    start: options.start,
    end: options.end,
    filter,
  };
  if (wordIds) payload.wordIds = wordIds;
  if (bookName) payload.bookName = bookName;
  const data = repo.startPractice(payload);
  if (!data.items.length) {
    toast(wordIds ? '没有可练习的单词' : '这个范围里没有没练过的单词，去「复习」练已练过的吧');
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
    spokenKey: '',
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
  const isListen = p.mode === 'listen';
  const canHear = p.mode === 'en_zh' || isListen;

  let body;
  if (isSpell) {
    const disabled = p.answered ? 'disabled' : '';
    const placeholder = isListen ? '听发音，写出这个单词' : '输入英文，回车提交';
    body = `
      <div class="spell-box">
        <div class="spell-hint">${esc(item.hint)}　(${item.answer.length} 个字母)</div>
        <input id="spellInput" class="input" autocomplete="off" autocapitalize="off" spellcheck="false"
               placeholder="${placeholder}" value="${esc(p.input)}" ${disabled}>
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
  const dontKnow = p.answered ? '' : '<button class="btn ghost" data-action="dont-know">我不会</button>';
  const nextButton = p.answered
    ? `<button class="btn block" data-action="next">${p.index + 1 >= total ? '查看结果' : '下一题（Enter）'}</button>`
    : '';

  app.innerHTML = `
    <div class="center-col practice-wrap" id="practiceWrap">
      ${pageHead(`${modeLabel(p.mode)} · ${p.bookName}`, `
        ${canHear ? '<button class="icon-btn" data-action="speak" title="朗读单词">🔊</button>' : ''}
        <button class="icon-btn ${item.starred ? 'star-on' : ''}" data-action="star" title="星标">${item.starred ? '★' : '☆'}</button>
        <button class="icon-btn" data-action="exit" title="退出练习">✕</button>`)}
      <div class="practice-top">
        <div class="progress-text">第 ${p.index + 1} 题 / 共 ${total} 题</div>
        <div class="bar on-light" style="flex:1;margin-top:0"><i style="width:${percent}%"></i></div>
      </div>

      <div class="prompt-card ${canHear ? 'tappable' : ''}" ${canHear ? 'data-action="speak" title="点一下再听一遍"' : ''}>
        <div class="prompt-label">${isListen ? '听 发 音' : (isSpell || p.mode === 'zh_en' ? '中 文 释 义' : '英 文')}</div>
        <div class="prompt">${esc(item.prompt)}</div>
        ${canHear && !isListen ? '<div class="speak-tip">点一下再听一遍</div>' : ''}
      </div>

      ${body}
      ${!p.answered && item.firstTime ? `<div class="practice-skip">
        <button class="btn text small danger-text" data-action="skip-word">不再练习此单词</button>
      </div>` : ''}
      ${feedback}
      <div class="practice-actions">${dontKnow}${nextButton}</div>
      <div class="kbd-tip">按 <kbd>1</kbd>–<kbd>4</kbd> 或 <kbd>A</kbd>–<kbd>D</kbd> 选择，<kbd>Enter</kbd> 下一题${isSpell ? '，<kbd>Enter</kbd> 提交拼写' : ''}；手机上左滑＝我不会，长按＝加星</div>
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

  bindGestures(document.getElementById('practiceWrap'));
  autoplayWord(item);
}

/** 练习页手势：左滑＝我不会，长按＝加星，和 Android 版一致。 */
function bindGestures(el) {
  if (!el || !('ontouchstart' in window)) return;
  let start = null;
  let moved = false;
  let timer = 0;
  const cancel = () => { if (timer) { clearTimeout(timer); timer = 0; } };

  el.addEventListener('touchstart', (event) => {
    if (event.touches.length !== 1) return;
    if (event.target.closest('input, textarea, select')) return;
    const touch = event.touches[0];
    start = { x: touch.clientX, y: touch.clientY };
    moved = false;
    cancel();
    timer = setTimeout(() => {
      timer = 0;
      if (!moved && start) { start = null; toggleStar(); }
    }, 520);
  }, { passive: true });

  el.addEventListener('touchmove', (event) => {
    if (!start) return;
    const touch = event.touches[0];
    if (Math.abs(touch.clientX - start.x) > 12 || Math.abs(touch.clientY - start.y) > 12) {
      moved = true;
      cancel();
    }
  }, { passive: true });

  el.addEventListener('touchend', (event) => {
    cancel();
    if (!start || moved) { start = null; return; }
    const touch = event.changedTouches[0];
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    start = null;
    if (dx < -80 && Math.abs(dx) > Math.abs(dy) * 1.5) markUnknown();
  }, { passive: true });

  el.addEventListener('touchcancel', () => { cancel(); start = null; }, { passive: true });
}

/** 进入新题、或答题后揭晓答案时朗读单词。 */
function autoplayWord(item) {
  const p = state.practice;
  if (!p || !settings.ttsEnabled()) return;
  const canHear = p.mode === 'en_zh' || p.mode === 'listen';
  if (!canHear && !p.answered) return;
  const key = `${p.index}:${p.answered ? 'a' : 'q'}`;
  if (p.spokenKey === key) return;
  p.spokenKey = key;
  speakWord(item.word);
}

let speechWarned = false;

function speakWord(text) {
  const error = speak(text);
  if (error && !speechWarned) {
    speechWarned = true;
    toast(error);
  }
}

/** 「我不会」：直接记为答错，进错题本并揭晓答案。 */
function markUnknown() {
  const p = state.practice;
  if (!p || p.answered) return;
  const item = p.items[p.index];
  p.answered = true;
  p.choice = null;
  p.records.push({
    wordId: item.wordId, word: item.word, meaning: item.meaning,
    answer: item.answer, userAnswer: '我不会', correct: false,
  });
  renderPractice();
  try {
    repo.answer(item.wordId, p.mode, false);
  } catch (err) {
    toast(err.message);
  }
}

/** 首练时点「不再练习此单词」：直接标成已掌握，移出本轮并跳到下一题。 */
function markLearned() {
  const p = state.practice;
  if (!p || p.answered) return;
  const item = p.items[p.index];
  try {
    repo.setLearned(item.wordId, true);
  } catch (err) {
    toast(err.message);
    return;
  }
  p.items.splice(p.index, 1);
  toast(`「${item.word}」已加入已掌握，不再抽到`);
  // 跳过的正好是最后一题：有答题记录就进结果页，否则回首页
  if (!p.items.length || p.index >= p.items.length) {
    if (p.records.length) {
      state.result = { mode: p.mode, bookName: p.bookName, records: p.records };
      state.practice = null;
      location.hash = '#/result';
    } else {
      state.practice = null;
      location.hash = '#/';
    }
    return;
  }
  p.answered = false;
  p.choice = null;
  p.input = '';
  p.spokenKey = '';
  renderPractice();
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
    repo.answer(item.wordId, p.mode, correct);
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
    repo.answer(item.wordId, p.mode, correct);
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
    repo.setStar(item.wordId, starred);
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

  // 这批词练完后的下次复习时间
  const ids = result.records.map((r) => r.wordId);
  const nextReview = repo.nextReviewOf(ids);

  app.innerHTML = `
    <div class="center-col">
      ${pageHead('练习结果')}
      <div class="card result-card">
        <div class="score">${percent}%</div>
        <div class="result-detail">答对 ${correct} / ${total} 题 · ${esc(modeLabel(result.mode))} · ${esc(result.bookName)}</div>
        <div class="bar on-light" style="margin-top:16px"><i style="width:${percent}%"></i></div>
      </div>

      ${nextReview.total ? `
      <div class="card review-next">
        <div class="review-next-head">
          <div>
            <div class="title">这批词的下次复习</div>
            <small>共 ${nextReview.total} 个词，按最早到期算</small>
          </div>
          <div class="review-next-when">${esc(nextReview.label)}</div>
        </div>
        <div class="review-next-row">
          <div><b>${nextReview.today}</b><span>今天再来</span></div>
          <div><b>${nextReview.tomorrow}</b><span>明天</span></div>
          <div><b>${nextReview.later}</b><span>更久以后</span></div>
        </div>
      </div>` : ''}

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
  await startPractice({ count: ids.length, start: 1, end: Number.MAX_SAFE_INTEGER }, ids);
}

/* ---------- 词表 ---------- */

/* 一次只渲染这么多行：内置词库 3793 条，手机上一次性铺开会很卡 */
const LIST_PAGE = 200;

async function renderList() {
  const book = currentBook();
  if (!book) { location.hash = '#/'; return; }
  const filter = state.listFilter;
  state.listLimit = LIST_PAGE;
  const data = await loadListData(book, filter);
  state.listData = data;
  const NAV_FILTERS = { starred: '星标词汇', mistakes: '错题本' };
  const isNavPage = Boolean(NAV_FILTERS[filter]);
  const title = filter === 'blocked'
    ? '已屏蔽单词'
    : (NAV_FILTERS[filter] || '词表');
  const isMistakes = filter === 'mistakes';

  const sortTabs = isMistakes ? `
      <div class="seg-group">
        ${[['recent', '最近答错'], ['wrong', '错得最多'], ['alpha', '按字母']].map(([key, label]) => `
          <button class="seg${state.mistakeSort === key ? ' on' : ''}" data-action="mistake-sort" data-sort="${key}">${label}</button>`).join('')}
      </div>` : '';

  app.innerHTML = `
    <div class="center-col wide">
      ${pageHead(title, `
        ${filter === 'all' && !book.builtin && book.blockedCount ? `<button class="btn text small" data-action="show-blocked">已屏蔽（${book.blockedCount}）</button>` : ''}
        ${filter === 'blocked' ? '<button class="btn text small" data-action="show-all">返回词表</button>' : ''}
        ${filter === 'all' && !book.builtin ? `<button class="btn text small" data-action="append">追加单词</button>` : ''}
        ${filter === 'blocked' && data.words.length ? '<button class="btn text small" data-action="unblock-all">全部恢复</button>' : ''}
        ${isMistakes && data.words.length ? '<button class="btn text small" data-action="export-mistakes">导出</button><button class="btn text small danger-text" data-action="clear-mistakes">一键清空</button>' : ''}`,
    '#/', isNavPage)}
      ${sortTabs}
      <div class="toolbar-row">
        <input id="searchInput" class="search" placeholder="${isMistakes ? '搜索错题单词或释义' : '搜索单词或释义'}" value="${esc(state.search)}">
      </div>
      <div class="list-meta" id="listMeta">${listMetaText(filter, data, book)}</div>
      <div id="listRows">${listRowsHtml(data, filter, book)}</div>
      <div id="listMore">${listMoreHtml(data)}</div>
      <div class="footer-actions" style="margin-top:16px">
        ${filter === 'blocked' ? '' : `<button class="btn block" data-action="practice-list" ${data.words.length ? '' : 'disabled'}>练习这些单词</button>`}
      </div>
      ${isMistakes && data.words.length ? '<div class="hint" style="text-align:center;margin-top:10px">连对 2 次自动移出，也可以长按移出</div>' : ''}
    </div>`;

  const search = document.getElementById('searchInput');
  search.addEventListener('input', () => {
    state.search = search.value;
    state.listLimit = LIST_PAGE;
    clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(async () => {
      const fresh = await loadListData(currentBook(), filter);
      state.listData = fresh;
      document.getElementById('listRows').innerHTML = listRowsHtml(fresh, filter, currentBook());
      document.getElementById('listMeta').textContent = listMetaText(filter, fresh, currentBook());
      document.getElementById('listMore').innerHTML = listMoreHtml(fresh);
    }, 220);
  });

  if (isMistakes) bindLongPress();
}

/** 错题本长按某一行：手动移出错题本。 */
function bindLongPress() {
  const rows = document.getElementById('listRows');
  if (!rows) return;
  let timer = 0;
  let target = null;
  const cancel = () => { clearTimeout(timer); timer = 0; target = null; };

  rows.addEventListener('pointerdown', (event) => {
    const row = event.target.closest('[data-longpress]');
    if (!row) return;
    target = row;
    timer = setTimeout(async () => {
      timer = 0;
      // 先抓住元素：手指抬起会触发 cancel 把 target 清空
      const element = target;
      if (!element) return;
      const id = Number(element.dataset.longpress);
      const name = element.dataset.word || '';
      element.classList.add('pressing');
      const ok = await confirmDialog('移出错题本？', `只移出错题本，练习记录和复习排期不变。`, '移出');
      if (element.isConnected) element.classList.remove('pressing');
      if (!ok) return;
      try {
        repo.removeMistake(id);
        toast(`已移出 ${name}`);
        await renderList();
      } catch (err) { toast(err.message); }
    }, 550);
  });
  rows.addEventListener('pointerup', cancel);
  rows.addEventListener('pointerleave', cancel);
  rows.addEventListener('pointercancel', cancel);
  rows.addEventListener('contextmenu', (e) => { if (timer) { e.preventDefault(); cancel(); } });
}

async function loadListData(book, filter) {
  if (!book) return { words: [], counts: {} };
  if (filter === 'mistakes') {
    return repo.listMistakes(book.id, { sort: state.mistakeSort, query: state.search || '' });
  }
  return { words: repo.listWords(book.id, filter, state.search || '').words, counts: {} };
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
  const limit = Math.min(state.listLimit || 200, data.words.length);
  return data.words.slice(0, limit).map((word) => {
    const wrong = data.counts[word.id];
    const streak = data.streaks ? (data.streaks[word.id] || 0) : 0;
    let extra = '';
    if (wrong) {
      extra = filter === 'mistakes'
        ? `<div class="extra">错 ${wrong} 次${streak ? ` · 已连对 ${streak} 次，再对 ${2 - streak} 次移出` : ''}</div>`
        : `<div class="extra">错 ${wrong} 次</div>`;
    }
    const longpress = filter === 'mistakes' ? ` data-longpress="${word.id}" data-word="${esc(word.word)}"` : '';
    return `
      <div class="word-row${filter === 'mistakes' ? ' longpressable' : ''}"${longpress}>
        <div class="idx">${word.index == null ? '' : word.index}</div>
        <div class="body">
          <div class="w">${esc(word.word)}</div>
          <div class="m">${esc(word.pos ? `${word.pos} ${word.meaning}` : word.meaning)}</div>
          ${extra}
        </div>
        <div class="acts">
          <button class="icon-btn ${word.starred ? 'star-on' : ''}" data-action="row-star" data-id="${word.id}" title="星标">${word.starred ? '★' : '☆'}</button>
          ${filter === 'mistakes' ? `<button class="btn small ghost" data-action="row-remove-mistake" data-id="${word.id}">移出</button>` : ''}
          ${filter === 'blocked' ? `<button class="btn small ghost" data-action="row-unblock" data-id="${word.id}">恢复</button>`
    : (filter === 'all' && !book.builtin ? `<button class="btn small ghost" data-action="row-block" data-id="${word.id}">屏蔽</button>` : '')}
        </div>
      </div>`;
  }).join('');
}

function listMoreHtml(data) {
  const total = data.words.length;
  const shown = Math.min(state.listLimit || 200, total);
  if (shown >= total) return '';
  return `<button class="btn ghost block" data-action="list-more">显示更多（还有 ${total - shown} 个）</button>`;
}

async function practiceList() {
  const book = currentBook();
  if (!book) return;
  const data = state.listData || await loadListData(book, state.listFilter);
  const ids = data.words.filter((w) => !w.learned).map((w) => w.id);
  if (!ids.length) { toast('还没有可练习的单词'); return; }
  const filter = state.listFilter === 'mistakes' ? 'mistakes' : (state.listFilter === 'starred' ? 'starred' : 'all');
  const chosen = await chooseCount(ids.length);
  if (!chosen) return;
  await startPractice(
    { count: chosen, start: 1, end: Number.MAX_SAFE_INTEGER },
    chosen >= ids.length ? ids : ids.slice(0, chosen),
    filter,
  );
}

async function listRowAction(action, id) {
  const word = (state.listData && state.listData.words.find((w) => w.id === id)) || null;
  try {
    if (action === 'row-star') {
      const starred = !(word && word.starred);
      repo.setStar(id, starred);
      await renderList();
      return;
    }
    if (action === 'row-block') {
      repo.setBlocked(id, true);
      toast(`已屏蔽 ${word ? word.word : ''}`);
      await reloadBooks();
      await renderList();
      return;
    }
    if (action === 'row-unblock') {
      repo.setBlocked(id, false);
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
  const more = document.getElementById('listMore');
  if (more) more.innerHTML = listMoreHtml(data);
  const practiceBtn = document.querySelector('[data-action="practice-list"]');
  if (practiceBtn) practiceBtn.disabled = data.words.length === 0;
}

/* ---------- 已学过 ---------- */

/** 把时间戳说成人话：今天 / 明天 / 3 天后 / 已过期。 */
function dueText(dueAt, now = Date.now()) {
  if (!dueAt) return '还没排期';
  const startToday = new Date(now); startToday.setHours(0, 0, 0, 0);
  const startDue = new Date(dueAt); startDue.setHours(0, 0, 0, 0);
  const days = Math.round((startDue - startToday) / 86400000);
  if (days < 0) return `已过期 ${-days} 天`;
  if (days === 0) return '今天';
  if (days === 1) return '明天';
  return `${days} 天后`;
}

async function renderStudied() {
  const book = currentBook();
  if (!book) { location.hash = '#/'; return; }
  const filter = state.studiedFilter;
  const data = repo.studied(book.id, filter, state.search || '');
  state.listData = { words: data.words };
  const c = data.counts;

  const tabs = [
    ['all', '全部', c.all],
    ['unmastered', '还没掌握', c.unmastered],
    ['mastered', '已掌握', c.mastered],
    ['forgetting', '易忘', c.forgetting],
  ].map(([key, label, count]) => `
    <button class="seg${filter === key ? ' on' : ''}" data-action="studied-filter" data-filter="${key}">
      ${label}<i>${count}</i>
    </button>`).join('');

  app.innerHTML = `
    <div class="center-col wide studied-page">
      ${pageHead('已练词汇', '', '#/', true)}
      ${c.all ? `<div class="seg-group">${tabs}</div>
      <div class="toolbar-row">
        <input id="searchInput" class="search" placeholder="搜索单词或释义" value="${esc(state.search)}">
      </div>` : ''}
      <div class="list-meta" id="listMeta">${studiedMeta(filter, data)}</div>
      <div id="listRows">${studiedRowsHtml(data.words)}</div>
      ${c.all ? `<div class="footer-actions" style="margin-top:16px">
        <button class="btn block" data-action="studied-practice" ${data.words.length ? '' : 'disabled'}>练习这些单词</button>
      </div>` : ''}
    </div>`;

  const search = document.getElementById('searchInput');
  if (search) {
    search.addEventListener('input', () => {
      state.search = search.value;
      clearTimeout(state.searchTimer);
      state.searchTimer = setTimeout(() => {
        const fresh = repo.studied(currentBook().id, filter, state.search || '');
        state.listData = { words: fresh.words };
        document.getElementById('listRows').innerHTML = studiedRowsHtml(fresh.words);
        document.getElementById('listMeta').textContent = studiedMeta(filter, fresh);
        const btn = document.querySelector('[data-action="studied-practice"]');
        if (btn) btn.disabled = fresh.words.length === 0;
      }, 220);
    });
  }
}

function studiedMeta(filter, data) {
  if (!data.counts.all) return '这个词库还没有练过的词，先去练一轮吧';
  if (!data.words.length) return '没有符合条件的单词';
  const label = { all: '练过的词', unmastered: '还没掌握', mastered: '已掌握', forgetting: '易忘' }[filter] || '';
  return `${label} ${data.words.length} 个 · 快到期的在前`;
}

function studiedRowsHtml(words) {
  if (!words.length) return '<div class="empty">没有符合条件的单词</div>';
  return words.map((w) => {
    const now = Date.now();
    const overdue = w.dueAt && w.dueAt <= now;
    const tag = w.mastered
      ? '<span class="chip ok">已掌握</span>'
      : (w.forgetting ? '<span class="chip warn">易忘</span>' : `<span class="chip">${w.level} 级</span>`);
    const extra = w.learned
      ? '首练时标为已掌握 · 不再抽到，也不进复习计划'
      : `下次复习 ${dueText(w.dueAt, now)} · 练过 ${w.times} 次${w.wrong ? ` · 错 ${w.wrong} 次` : ''}`;
    return `
      <div class="word-row">
        <div class="idx">${w.index == null ? '' : w.index}</div>
        <div class="body">
          <div class="w">${esc(w.word)} ${tag}</div>
          <div class="m">${esc(w.pos ? `${w.pos} ${w.meaning}` : w.meaning)}</div>
          <div class="extra${overdue ? ' overdue' : ''}">${extra}</div>
        </div>
        <div class="acts">
          ${w.learned ? `<button class="btn small ghost" data-action="row-unlearn" data-id="${w.id}">恢复</button>` : ''}
          <button class="icon-btn ${w.starred ? 'star-on' : ''}" data-action="row-star" data-id="${w.id}" title="星标">${w.starred ? '★' : '☆'}</button>
        </div>
      </div>`;
  }).join('');
}

/* ---------- 词库管理 ---------- */

async function renderBooks() {
  await reloadBooks();
  const info = repo.info();
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

      <div class="hint" style="margin-top:16px">${esc(storageLine(info))}</div>
    </div>`;
}

function storageLine(info) {
  if (!info.persistent) return '浏览器不允许本地存储，本次修改在关闭后会丢失';
  return `已用 ${formatSize(info.usageBytes)} · 保存在本机，不上传`;
}

/** 字节数说成人话：不足 1MB 用 KB，否则用 MB。 */
function formatSize(bytes) {
  const n = Number(bytes) || 0;
  const mb = n / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

function downloadFile(name, text, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportBackup() {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  downloadFile(`单词练习备份-${stamp}.json`, repo.backupText());
  toast('备份已导出');
}

/** 导出当前词库的错题为 CSV。 */
function exportMistakesCsv(items, format) {
  const text = CSV_BOM + mistakesCsv(items, format);
  const name = csvFileName(format.kind, format.keep);
  downloadFile(name, text, 'text/csv;charset=utf-8');
  toast(`已导出 ${items.length} 个词`);
}

/** 把 listMistakes 的扁平词条与 counts/streaks 合并成 csv.js 需要的形状。 */
function mistakesForCsv(data) {
  return data.words.map((word) => ({
    word,
    wrong: (data.counts && data.counts[word.id]) || 0,
    streak: (data.streaks && data.streaks[word.id]) || 0,
  }));
}

async function restoreBackup(file) {
  let text = '';
  try {
    text = await file.text();
  } catch {
    toast('读取文件失败');
    return;
  }
  const ok = await confirmDialog('恢复备份？', '现有词库、星标、错题都会被覆盖，无法撤销。', '覆盖');
  if (!ok) return;
  try {
    const result = repo.restoreText(text);
    await reloadBooks();
    state.start = null;
    state.end = null;
    toast(`已恢复 ${result.books} 个词库、${result.words} 个单词`);
    location.hash = '#/';
    renderBooks();
  } catch (err) {
    toast(err.message);
  }
}

async function reloadBooks() {
  const data = repo.bootstrap();
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
    repo.deleteBook(id);
    await reloadBooks();
    toast('已删除');
    renderBooks();
  } catch (err) {
    toast(err.message);
  }
}

/* ---------- 导入 ---------- */

async function renderImport() {
  const book = state.importBookId ? repo.stats(state.importBookId) : null;
  const appending = Boolean(book);
  app.innerHTML = `
    ${pageHead(appending ? '追加单词' : '导入词汇表')}
    <div class="center-col">
      <div class="import-tip">
        <div class="import-tip-title">可以把词表发给你惯用的 AI，让它按下面的格式整理：</div>
        <pre class="import-tip-format">| 英文 | 词性 | 汉语 |
|---|---|---|
| competence | n. | 能力；胜任 |
| abandon | v. | 抛弃，舍弃 |</pre>
        <div class="import-tip-note">三列即可；没有词性就在词性处留空。序号列可留可不留。</div>
      </div>
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
  try {
    const data = repo.parseText(new Uint8Array(await file.arrayBuffer()));
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

function showPreview(data) {
  const preview = document.getElementById('preview');
  if (!preview) return;
  preview.hidden = false;
  if (!data.entries.length) {
    preview.textContent = '没解析到单词，确认是 Markdown 表格（| 英文 | 词性 | 汉语 |）。';
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
    const data = repo.parseText(new TextEncoder().encode(text));
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
      const result = repo.importInto(state.importBookId, importEntries);
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
    const result = repo.createBook(name, importEntries);
    toast(`已创建「${name}」，导入 ${result.added} 条`);
    await reloadBooks();
    state.bookId = result.bookId;
    location.hash = '#/';
  } catch (err) {
    toast(err.message);
  }
}

/* ---------- 学习报告 ---------- */

const WEEKDAY = ['日', '一', '二', '三', '四', '五', '六'];

async function renderReport() {
  app.classList.add('on-report');
  const goal = settings.dailyGoal();
  const { summary, mastery, wrong, upcoming } = repo.report(7, goal);
  const accuracy = summary.totalAnswered
    ? Math.round((summary.totalCorrect * 100) / summary.totalAnswered)
    : 0;
  const todayPercent = goal ? Math.min(100, Math.round((summary.todayAnswered * 100) / goal)) : 0;
  const maxDay = Math.max(...summary.days.map((day) => day.answered), 1);
  const lastKey = summary.days.length ? summary.days[summary.days.length - 1].date : '';

  const todayHint = summary.todayAnswered >= goal
    ? '今天的目标完成了'
    : (summary.todayAnswered === 0 ? '今天还没开始，先练几题' : `还差 ${goal - summary.todayAnswered} 题完成今日目标`);

  const chart = summary.days.map((day) => {
    const height = Math.round((day.answered / maxDay) * 100);
    const ms = new Date(`${day.date}T12:00:00`).getDay();
    return `
      <div class="chart-col${day.date === lastKey ? ' today' : ''}" title="${esc(day.date)} · ${day.answered} 题">
        <div class="chart-bar"><i style="height:${height}%"></i></div>
        <div class="chart-label">${WEEKDAY[ms]}</div>
      </div>`;
  }).join('');

  const review = repo.dueReview(0, 'due');
  const due = review.stats.due;
  const reviewTotal = review.stats.total;
  const hasReview = reviewTotal > 0;

  // 未来 7 天复习量：柱子上标数量，今天优先
  const maxFuture = Math.max(...upcoming.map((d) => d.count), 1);
  const futureChart = upcoming.map((day, i) => {
    const height = Math.round((day.count / maxFuture) * 100);
    const ms = new Date(`${day.date}T12:00:00`).getDay();
    const label = i === 0 ? '今天' : WEEKDAY[ms];
    return `
      <div class="chart-col${i === 0 ? ' today' : ''}" title="${esc(day.date)} · ${day.count} 词">
        <div class="chart-bar"><i style="height:${height}%"></i></div>
        <div class="chart-label">${label}</div>
        <div class="chart-count">${day.count || ''}</div>
      </div>`;
  }).join('');
  const futureTotal = upcoming.reduce((n, d) => n + d.count, 0);

  app.innerHTML = `
    <div class="center-col wide report-page">
      ${pageHead('学习报告', '<button class="btn small ghost" data-action="set-goal">调整目标</button>', '#/', true)}

      <div class="report-grid">
        <section class="report-tile span-2">
          <section class="hero">
            <div class="tag">今 日 进 度</div>
            <div class="big">${summary.todayAnswered} / ${goal} 题</div>
            <div class="bar"><i style="width:${todayPercent}%"></i></div>
            <div class="sub">${esc(todayHint)}</div>
          </section>
        </section>

        <section class="report-tile span-2">
          <div class="stat-grid">
            <div class="card stat">
              <div class="num">${summary.streak} <em>天</em></div>
              <div class="k">连续打卡</div>
            </div>
            <div class="card stat">
              <div class="num">${summary.totalAnswered} <em>题</em></div>
              <div class="k">累计答题</div>
            </div>
            <div class="card stat">
              <div class="num">${accuracy}<em>%</em></div>
              <div class="k">累计正确率</div>
            </div>
            <div class="card stat">
              <div class="num">${reviewTotal} <em>词</em></div>
              <div class="k">练过待复习${due ? ` · 今日到期 ${due}` : ''}</div>
            </div>
          </div>
        </section>

        <section class="report-tile">
          <div class="section-label">近 7 天</div>
          <div class="card report-card">
            <div class="chart">${chart}</div>
            <div class="divider"></div>
            <div class="report-facts">
              <div><b>${summary.totalCorrect}</b><span>答对题数</span></div>
              <div><b>${summary.totalAnswered - summary.totalCorrect}</b><span>答错题数</span></div>
              <div><b>${mastery.total}</b><span>涉及词数</span></div>
            </div>
          </div>
        </section>

        <section class="report-tile">
          <div class="section-label">未来 7 天复习量</div>
          <div class="card report-card">
            <div class="chart">${futureChart}</div>
            <div class="divider"></div>
            <div class="report-facts">
              <div><b>${upcoming[0] ? upcoming[0].count : 0}</b><span>今天该复习</span></div>
              <div><b>${futureTotal}</b><span>7 天内合计</span></div>
              <div><b>${reviewTotal}</b><span>练过的总数</span></div>
            </div>
          </div>
        </section>

        <section class="report-tile">
          <div class="section-label">掌握度</div>
          <div class="card report-card">
            <div class="report-figure">
              <div class="figure-num">${mastery.masteredPercent}<em>%</em></div>
              <div class="figure-k">已掌握 ${mastery.mastered} / ${mastery.total} 词</div>
            </div>
            <div class="bar on-light"><i style="width:${mastery.masteredPercent}%"></i></div>
            <div class="tier-list">
              ${mastery.tiers.map((tier) => `
                <div class="tier-row">
                  <span class="tier-name">${tier.label}</span>
                  <span class="tier-bar"><i class="tier-${tier.key}" style="width:${tier.percent}%"></i></span>
                  <span class="tier-num">${tier.count}</span>
                </div>`).join('')}
            </div>
            <div class="hint" style="margin-top:10px">新词 0 级 · 学习中 1–2 级 · 较熟 3–4 级 · 已掌握 5 级以后</div>
          </div>
        </section>

        <section class="report-tile">
          <div class="section-label">最该复习的词</div>
          <div class="card report-card">
            ${wrong.length ? `<div class="wrong-grid">${wrong.map((item) => `
              <div class="wrong-row">
                <b>${esc(item.word.word)}</b>
                <span>${esc(item.word.pos ? `${item.word.pos} ${item.word.meaning}` : item.word.meaning)}</span>
                <em>错 ${item.wrong} 次</em>
              </div>`).join('')}</div>` : '<div class="hint">还没有错题</div>'}
          </div>
        </section>

        <section class="report-tile span-2">
          <div class="report-actions">
            <button class="btn" data-action="review" ${hasReview ? '' : 'disabled'}>
              ${hasReview
    ? (due ? `复习 ${due} 个到期词` : `复习练过的 ${reviewTotal} 个词`)
    : '练过之后就能复习'}
            </button>
            <div class="setting-row" style="padding:0">
              <div class="setting-text">
                <div class="title">练习时朗读单词</div>
                <small>自动读出当前单词的发音</small>
              </div>
              <label class="switch" title="练习时自动朗读">
                <input id="ttsInput" type="checkbox" ${settings.ttsEnabled() ? 'checked' : ''}>
                <span class="switch-track"><span class="switch-thumb"></span></span>
              </label>
            </div>
            <button class="btn ghost small" data-action="test-tts">试听发音</button>
          </div>
        </section>
      </div>
    </div>`;
}

/* ---------- 设置 ---------- */

async function renderSettings() {
  const version = (state.about && state.about.version) || repo.VERSION;
  const pref = themePref();
  app.innerHTML = `
    <div class="center-col wide settings-page">
      ${pageHead('设置', themeToggleHtml(pref), '#/', true)}

      <div class="settings-grid">
        <section class="settings-tile">
          <div class="section-label">学习</div>
          <div class="card settings">
            <div class="line">
              <div><div class="title">每日目标</div><small>5 – 200 题，学习报告按它算进度</small></div>
              <div class="unit-field">
                <input id="goalInput" class="input narrow" type="number" min="5" max="200" value="${settings.dailyGoal()}">
                <span class="unit">题</span>
              </div>
            </div>
            <div class="divider"></div>
            <div class="setting-row" style="padding-top:0">
              <div class="setting-text">
                <div class="title">自动朗读</div>
                <small>练习时自动读出单词发音</small>
              </div>
              <label class="switch" title="练习时自动朗读">
                <input id="ttsInput" type="checkbox" ${settings.ttsEnabled() ? 'checked' : ''}>
                <span class="switch-track"><span class="switch-thumb"></span></span>
              </label>
            </div>
            <div class="setting-row" style="padding-bottom:0">
              <div class="setting-text">
                <div class="title">试听发音</div>
                <small>测试浏览器语音</small>
              </div>
              <button class="btn ghost small" data-action="test-tts">试听</button>
            </div>
            <div class="divider"></div>
            <div class="setting-row" style="padding-bottom:0">
              <div class="setting-text">
                <div class="title">练习记录</div>
                <small>清空后所有单词重新算「没练过」</small>
              </div>
              <button class="btn ghost small danger-text" data-action="clear-log">清空</button>
            </div>
          </div>
        </section>

        <section class="settings-tile">
          <div class="section-label">数据与备份</div>
          <div class="card settings">
            <div class="setting-row" style="padding-top:0">
              <div class="setting-text">
                <div class="title">自动备份</div>
                <small>定时把数据存成本地快照，误删时可恢复</small>
              </div>
              <label class="switch" title="启用自动备份">
                <input id="autobackupInput" type="checkbox" ${settings.autoBackupEnabled() ? 'checked' : ''}>
                <span class="switch-track"><span class="switch-thumb"></span></span>
              </label>
            </div>

            <div class="setting-row">
              <div class="setting-text">
                <div class="title">备份间隔</div>
                <small>0 表示只在关闭页面时写一份</small>
              </div>
              <div class="unit-field">
                <input id="backupIntervalInput" class="input narrow" type="number" min="0" max="168" value="${settings.backupIntervalHours()}">
                <span class="unit">小时</span>
              </div>
            </div>

            <div class="setting-row">
              <div class="setting-text">
                <div class="title">保留份数</div>
                <small>超出的旧快照会自动删除</small>
              </div>
              <div class="unit-field">
                <input id="backupKeepInput" class="input narrow" type="number" min="1" max="50" value="${settings.backupKeepCount()}">
                <span class="unit">份</span>
              </div>
            </div>

            <div class="divider"></div>

            <div class="btn-row backup-actions">
              <button class="btn ghost small" data-action="export-backup">导出备份</button>
              <button class="btn ghost small" data-action="import-backup">恢复备份</button>
              <button class="btn ghost small" data-action="save-autobackup-now">立即存一份快照</button>
              <button class="btn small danger-text" data-action="clear-backup-cache">清除缓存</button>
            </div>

            <div class="hint" style="margin-top:12px" id="backupStatus">${esc(backupStatusText())}</div>
            <input id="backupFile" type="file" accept="application/json,.json" hidden>
          </div>
        </section>
        <section class="settings-tile">
          <div class="section-label">其他</div>
          <div class="card settings">
            <div class="setting-row" style="padding-top:0">
              <div class="setting-text">
                <div class="title">Android 版 App</div>
                <small>下载 APK 安装包（${androidApkUrl().version}）</small>
              </div>
              <a class="btn small ghost" href="${androidApkUrl().url}" target="_blank" rel="noopener">下载</a>
            </div>
            <div class="setting-row">
              <div class="setting-text">
                <div class="title">iOS 安装教程</div>
                <small>把网页加到主屏幕的步骤</small>
              </div>
              <a class="btn small ghost" href="https://github.com/SpeakerC/worddrill-web/releases/tag/ios-1.6" target="_blank" rel="noopener">查看教程</a>
            </div>
            <div class="setting-row">
              <div class="setting-text">
                <div class="title">隐私政策</div>
                <small>数据存在哪、何时联网</small>
              </div>
              <button class="btn small ghost" data-action="privacy">查看</button>
            </div>
            <div class="setting-row">
              <div class="setting-text">
                <div class="title">开放源代码许可</div>
                <small>GPLv3，词库来自开源项目</small>
              </div>
              <a class="btn small ghost" href="https://github.com/SpeakerC/worddrill-web/blob/main/LICENSE" target="_blank" rel="noopener">查看</a>
            </div>
            <div class="setting-row" style="padding-bottom:0">
              <div class="setting-text">
                <div class="title">关于</div>
                <small>版本 ${esc(version)}</small>
              </div>
              <button class="btn small ghost" data-action="about">查看</button>
            </div>
          </div>
        </section>

      </div>
    </div>`;

  const backupFile = document.getElementById('backupFile');
  if (backupFile) {
    backupFile.addEventListener('change', async () => {
      const file = backupFile.files && backupFile.files[0];
      if (!file) return;
      await restoreBackup(file);
      backupFile.value = '';
    });
  }
  const ttsInput = document.getElementById('ttsInput');
  if (ttsInput) {
    ttsInput.addEventListener('change', () => {
      const label = document.getElementById('ttsState');
      if (label) label.textContent = ttsInput.checked ? '已开启' : '已关闭';
    });
  }
  syncAutoBackupUI();
}

/** 自动备份区：关闭开关时灰掉间隔与份数，并显示快照概况。 */
function syncAutoBackupUI() {
  const enabled = settings.autoBackupEnabled();
  for (const id of ['backupIntervalInput', 'backupKeepInput']) {
    const el = document.getElementById(id);
    if (el) {
      el.disabled = !enabled;
      el.style.opacity = enabled ? '1' : '0.45';
    }
  }
  const status = document.getElementById('backupStatus');
  if (status) status.textContent = backupStatusText();
}

function backupStatusText() {
  const info = repo.info();
  const snaps = repo.listAutoBackups();
  const storage = info.persistent
    ? `已用 ${formatSize(info.usageBytes)} · 保存在本机，不上传`
    : '浏览器不允许本地存储，本次修改在关闭后会丢失';
  if (!snaps.length) return `${storage}　·　还没有快照`;
  const last = new Date(snaps[0].at);
  const mm = String(last.getMonth() + 1).padStart(2, '0');
  const dd = String(last.getDate()).padStart(2, '0');
  const hh = String(last.getHours()).padStart(2, '0');
  const mi = String(last.getMinutes()).padStart(2, '0');
  return `${storage}　·　${snaps.length} 份，最近 ${mm}-${dd} ${hh}:${mi}`;
}

/* ---------- 隐私政策 ---------- */

async function renderPrivacy() {
  let text = '';
  try {
    const res = await fetch('./assets/privacy.txt', { cache: 'no-cache' });
    if (res.ok) text = await res.text();
  } catch {
    text = '';
  }
  app.innerHTML = `
    <div class="center-col">
      ${pageHead('隐私政策', '', '#/settings')}
      <div class="card">
        <div class="prose">${text ? esc(text) : '隐私政策加载失败，请联网刷新后再试。'}</div>
      </div>
    </div>`;
}

/* ---------- 复习（所有练过的词，不只是错题） ---------- */

/**
 * 复习入口。默认复习「今天该复习的」，也可以切到「全部练过的词」。
 * 只要练过一次（答对答错都算）就会排进来：答对越久越靠后，答错回到最前面。
 */
async function startReview(forcedScope = '') {
  let data;
  try {
    data = repo.dueReview(200, forcedScope || 'due');
  } catch (err) {
    toast(err.message);
    return;
  }
  if (!data.stats.total) {
    toast('还没有练过的单词，先做一轮练习吧');
    if (location.hash.includes('report')) renderReport();
    return;
  }

  let scope = data.scope;
  // 只有「今天该复习的」不为空时才让用户选范围；否则直接复习全部练过的词
  if (!forcedScope && data.count > 0 && data.stats.total > data.count) {
    const picked = await chooseReviewScope(data.stats);
    if (!picked) return;
    scope = picked;
    if (scope !== data.scope) {
      try { data = repo.dueReview(200, scope); } catch (err) { toast(err.message); return; }
    }
  } else if (!forcedScope && data.count === 0 && data.stats.total > 0) {
    scope = 'all';
    try { data = repo.dueReview(200, scope); } catch (err) { toast(err.message); return; }
  }

  if (!data.words.length) {
    toast('今天该复习的已经复习完了，明天再来');
    if (location.hash.includes('report')) renderReport();
    return;
  }

  const choice = await chooseMode(`复习 ${data.words.length} 个单词`);
  if (!choice) return;
  state.mode = choice;
  prefs.set('worddrill.mode', choice);
  await startPractice(
    { count: data.words.length, start: 1, end: Number.MAX_SAFE_INTEGER },
    data.words.map((word) => word.id),
    'review',
    scope === 'all' ? '复习' : '今日复习',
  );
}

/** 选复习范围：今天该复习的 / 全部练过的词。 */
function chooseReviewScope(stats) {
  return new Promise((resolve) => {
    const overlay = openModal(`
      <div class="about-card" style="text-align:left">
        <h3 style="margin-top:0">复习哪些单词</h3>
        <div class="mode-list">
          <button class="mode" data-scope="due">
            <span>
              <b>今天该复习的 ${stats.due} 个</b>
              <small>到期该过一遍的词${stats.overdue ? `，含 ${stats.overdue} 个之前答错的` : ''}${stats.fresh ? `；${stats.fresh} 个刚练过还没排上` : ''}</small>
            </span>
          </button>
          <button class="mode" data-scope="all">
            <span>
              <b>全部练过的 ${stats.total} 个</b>
              <small>把练过的词从头再过一遍，最久没练的排在前面</small>
            </span>
          </button>
        </div>
      </div>`);
    overlay.querySelectorAll('[data-scope]').forEach((button) => {
      button.addEventListener('click', () => {
        const value = button.dataset.scope;
        overlay.remove();
        resolve(value);
      });
    });
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) { overlay.remove(); resolve(''); }
    });
  });
}

/* ---------- 通用对话框：选题 */

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

/** 导出错题：先选版本，练习版再选留英文还是留中文。 */
function chooseExportFormat(count) {
  return new Promise((resolve) => {
    const overlay = openModal(`
      <div class="about-card" style="text-align:left">
        <h3 style="margin-top:0">导出错题</h3>
        <p class="hint" style="margin:0 0 12px">共 ${count} 个词</p>
        <div class="mode-list">
          <button class="mode" data-format="review">
            <span><b>复习版</b><small>英汉对照，带词性与答错次数</small></span>
          </button>
          <button class="mode" data-format="practice-en">
            <span><b>练习版 · 只留英文</b><small>看英文回忆中文，适合自测</small></span>
          </button>
          <button class="mode" data-format="practice-zh">
            <span><b>练习版 · 只留中文</b><small>看中文拼写英文，适合默写</small></span>
          </button>
        </div>
        <div class="footer-actions" style="margin-top:16px">
          <button class="btn ghost" data-close>取消</button>
        </div>
      </div>`);
    overlay.querySelectorAll('[data-format]').forEach((button) => {
      button.addEventListener('click', () => {
        const value = button.dataset.format;
        overlay.remove();
        resolve(value === 'review' ? { kind: 'review', keep: 'en' } : { kind: 'practice', keep: value === 'practice-zh' ? 'zh' : 'en' });
      });
    });
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) resolve(null);
    });
    overlay.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => resolve(null)));
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

function chooseMode(title) {
  return new Promise((resolve) => {
    const overlay = openModal(`
      <div class="about-card" style="text-align:left">
        <h3 style="margin-top:0">${esc(title)}</h3>
        <div class="mode-list">
          ${Object.keys(state.modes).map((key) => {
    const info = state.modes[key] || {};
    return `<button class="mode" data-mode="${key}">
              <span><b>${esc(info.label || key)}</b><small>${esc(info.desc || '')}</small></span>
            </button>`;
  }).join('')}
        </div>
      </div>`);
    overlay.querySelectorAll('[data-mode]').forEach((button) => {
      button.addEventListener('click', () => {
        const value = button.dataset.mode;
        overlay.remove();
        resolve(value);
      });
    });
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) { overlay.remove(); resolve(''); }
    });
  });
}

function askGoal() {
  return new Promise((resolve) => {
    const overlay = openModal(`
      <div class="about-card" style="text-align:left">
        <h3 style="margin-top:0">每日目标</h3>
        <p class="hint">5 – 200 题，学习报告按它算今天完成了多少。</p>
        <input id="goalDialogInput" class="input" type="number" min="${settings.GOAL_MIN}" max="${settings.GOAL_MAX}" value="${settings.dailyGoal()}">
        <div class="footer-actions" style="margin-top:18px">
          <button class="btn ghost" data-close>取消</button>
          <button class="btn" data-ok>保存</button>
        </div>
      </div>`);
    overlay.querySelector('[data-ok]').addEventListener('click', () => {
      const value = Number(overlay.querySelector('#goalDialogInput').value);
      if (!Number.isFinite(value) || value < settings.GOAL_MIN || value > settings.GOAL_MAX) {
        toast(`请输入 ${settings.GOAL_MIN} – ${settings.GOAL_MAX} 之间的数字`);
        return;
      }
      const saved = settings.setDailyGoal(value);
      overlay.remove();
      toast(`每日目标已设为 ${saved} 题`);
      if (location.hash.includes('report')) renderReport();
      resolve(saved);
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
      <img class="logo" src="./icon.png" alt="">
      <h3>${esc(info.name || '单词练习')}</h3>
      <div class="ver">版本 ${esc(info.version || '1.0.0')}</div>
      <div class="sum">${richText(info.summary || '')}</div>
      ${rows.length ? `<div class="about-rows">
        ${rows.map((row) => `<div class="about-row">
          ${row.label ? `<span class="k">${esc(row.label)}</span>` : ''}
          <span class="v">${richText(row.value)}</span>
        </div>`).join('')}
      </div>` : ''}
      ${info.note ? `<div class="about-note">${richText(info.note)}</div>` : ''}
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
    case 'back':
      location.hash = target.dataset.back || '#/';
      break;
    case 'open-nav':
      openNavDrawer();
      break;
    case 'about':
      showAbout();
      break;
    case 'report':
      location.hash = '#/report';
      break;
    case 'settings':
      location.hash = '#/settings';
      break;
    case 'privacy':
      location.hash = '#/privacy';
      break;
    case 'review':
      await startReview();
      break;
    case 'set-goal':
      await askGoal();
      break;
    case 'toggle-theme': {
      const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      setThemePref(next);
      const on = next === 'dark';
      target.classList.toggle('is-dark', on);
      target.setAttribute('aria-checked', String(on));
      target.title = on ? '切换到浅色' : '切换到深色';
      break;
    }
    case 'test-tts': {
      const error = speak('hello, this is a test');
      toast(error || '已调用浏览器语音，能听到声音说明正常');
      break;
    }
    case 'speak': {
      const p = state.practice;
      if (p && p.items[p.index]) speakWord(p.items[p.index].word);
      break;
    }
    case 'dont-know':
      markUnknown();
      break;
    case 'mode':
      state.mode = target.dataset.mode;
      prefs.set('worddrill.mode', state.mode);
      await renderHome();
      break;
    case 'start':
      await startPracticeFromHome();
      break;
    case 'list':
      state.listFilter = 'all';
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
    case 'skip-word':
      markLearned();
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
    case 'list-more': {
      state.listLimit = (state.listLimit || 200) + 200;
      const rows = document.getElementById('listRows');
      const more = document.getElementById('listMore');
      if (rows) rows.innerHTML = listRowsHtml(state.listData, state.listFilter, currentBook());
      if (more) more.innerHTML = listMoreHtml(state.listData);
      break;
    }
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
      const ok = await confirmDialog('恢复全部屏蔽单词？', `恢复「${book.name}」里所有被屏蔽的单词。`, '全部恢复');
      if (!ok) return;
      try {
        repo.unblockAll(book.id);
        await reloadBooks();
        await refreshList();
        toast('已全部恢复');
      } catch (err) { toast(err.message); }
      break;
    }
    case 'mistake-sort':
      state.mistakeSort = target.dataset.sort || 'recent';
      state.listLimit = LIST_PAGE;
      await renderList();
      break;
    case 'row-remove-mistake': {
      const id = Number(target.dataset.id);
      const word = (state.listData && state.listData.words.find((w) => w.id === id)) || null;
      try {
        repo.removeMistake(id);
        toast(`已移出 ${word ? word.word : '该单词'}`);
        await renderList();
      } catch (err) { toast(err.message); }
      break;
    }
    case 'studied-filter':
      state.studiedFilter = target.dataset.filter || 'all';
      state.search = '';
      await renderStudied();
      break;
    case 'row-unlearn': {
      const id = Number(target.dataset.id);
      try {
        repo.setLearned(id, false);
        toast('已恢复成没练过的词，会重新出现在新练习里');
        await renderStudied();
      } catch (err) { toast(err.message); }
      break;
    }
    case 'studied-practice': {
      const book = currentBook();
      const data = state.listData && state.listData.words ? state.listData.words : [];
      const ids = data.map((w) => w.id);
      if (!ids.length) { toast('还没有可练习的单词'); return; }
      const chosen = await chooseCount(ids.length);
      if (!chosen) return;
      await startPractice(
        { count: chosen, start: 1, end: Number.MAX_SAFE_INTEGER },
        chosen >= ids.length ? ids : ids.slice(0, chosen),
        'all',
        book.name,
      );
      break;
    }
    case 'export-mistakes': {
      const book = currentBook();
      const data = await loadListData(book, 'mistakes');
      if (!data.words.length) { toast('错题本是空的'); return; }
      const format = await chooseExportFormat(data.words.length);
      if (!format) return;
      try {
        exportMistakesCsv(mistakesForCsv(data), format);
      } catch (err) { toast(err.message); }
      break;
    }
    case 'clear-mistakes': {
      const book = currentBook();
      const ok = await confirmDialog('清空错题本？', `清空「${book.name}」的错题记录，星标不受影响。`, '清空');
      if (!ok) return;
      try {
        repo.clearMistakes(book.id);
        await renderList();
        toast('已清空错题本');
      } catch (err) { toast(err.message); }
      break;
    }
    case 'clear-log': {
      const ok = await confirmDialog('清空练习记录？', '练过的单词重新算「没练过」，复习排期一并清空。星标、错题和已掌握标记不受影响。', '清空');
      if (!ok) return;
      try {
        repo.clearLog();
        if (location.hash.includes('settings')) await renderSettings();
        else await renderHome();
        toast('已清空练习记录');
      } catch (err) { toast(err.message); }
      break;
    }
    case 'save-autobackup-now': {
      try {
        const kept = repo.saveAutoBackupNow();
        syncAutoBackupUI();
        toast(`已保存一份自动备份快照，当前保留 ${kept} 份`);
      } catch (err) { toast(err.message); }
      break;
    }
    case 'clear-backup-cache': {
      const ok = await confirmDialog('清除备份缓存？', '删除全部自动快照和离线缓存，学习数据不受影响。建议先导出备份。', '清除');
      if (!ok) return;
      try {
        const removed = repo.clearAutoBackups();
        const caches = await repo.clearOfflineCache();
        await renderSettings();
        toast(`已清除 ${removed} 份自动备份快照、${caches} 个离线缓存`);
      } catch (err) { toast(err.message); }
      break;
    }
    case 'open-book':
      state.bookId = Number(target.dataset.id);
      prefs.set('worddrill.bookId', state.bookId);
      location.hash = '#/list';
      break;
    case 'delete-book':
      await deleteBook(Number(target.dataset.id));
      break;
    case 'export-backup':
      exportBackup();
      break;
    case 'import-backup':
      document.getElementById('backupFile').click();
      break;
    case 'dismiss-install':
      prefs.set('worddrill.installTip', 'off');
      document.querySelectorAll('.install-tip, .modal').forEach((el) => el.remove());
      break;
    default:
      break;
  }
});

app.addEventListener('change', (event) => {
  if (event.target.id === 'goalInput') {
    const value = Number(event.target.value);
    if (!Number.isFinite(value) || value < settings.GOAL_MIN || value > settings.GOAL_MAX) {
      toast(`每日目标请填 ${settings.GOAL_MIN} – ${settings.GOAL_MAX}`);
      event.target.value = settings.dailyGoal();
      return;
    }
    const saved = settings.setDailyGoal(value);
    event.target.value = saved;
    toast(`每日目标已设为 ${saved} 题`);
  }
  if (event.target.id === 'ttsInput') {
    settings.setTtsEnabled(event.target.checked);
    if (event.target.checked) speakWord('hello');
    toast(event.target.checked ? '已开启朗读' : '已关闭朗读');
  }
  if (event.target.id === 'autobackupInput') {
    settings.setAutoBackupEnabled(event.target.checked);
    syncAutoBackupUI();
    toast(event.target.checked ? '已开启自动备份' : '已关闭自动备份');
  }
  if (event.target.id === 'backupIntervalInput') {
    const value = settings.setBackupIntervalHours(event.target.value);
    event.target.value = value;
    toast(`自动备份间隔：${value === 0 ? '仅关闭页面前写入' : value + ' 小时'}`);
  }
  if (event.target.id === 'backupKeepInput') {
    const value = settings.setBackupKeepCount(event.target.value);
    event.target.value = value;
    toast(`最多保留 ${value} 份自动备份`);
  }
});

/* 首页输入即时保存，换模式/重绘不丢 */
app.addEventListener('input', (event) => {
  if (event.target.id === 'countInput') state.count = Number(event.target.value) || 0;
  if (event.target.id === 'startInput') state.start = Number(event.target.value) || null;
  if (event.target.id === 'endInput') state.end = Number(event.target.value) || null;
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

/* ---------- 离线 / 安装 ---------- */

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  try {
    const registration = await navigator.serviceWorker.register(new URL('sw.js', import.meta.url), { scope: './', updateViaCache: 'none' });
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      if (!worker) return;
      worker.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) {
          toast('有新版本，重新打开页面后生效');
        }
      });
    });
  } catch (err) {
    console.warn('离线缓存注册失败：', err);
  }
}

/** 安卓 APK 的版本与下载地址，设置页和首页底部的下载按钮共用。 */
function androidApkUrl() {
  const version = '1.4.4';
  return {
    version,
    url: `https://gitee.com/MTeaCase/worddrill/releases/download/v${version}/WordDrill-${version}.apk`,
  };
}

const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches
  || window.navigator.standalone === true;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const isAndroid = () => /android/i.test(navigator.userAgent);

/* 方便调试和自动化测试 */
window.worddrill = { repo };

/* 启动 */
boot().catch((err) => {
  app.innerHTML = `<div class="card" style="margin-top:60px">
    <h2>启动失败</h2><p>${esc(err.message)}</p>
    <p class="hint">确认浏览器允许本地存储后刷新重试。</p></div>`;
});





















