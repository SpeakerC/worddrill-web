/**
 * 深色模式：跟随系统 / 强制浅色 / 强制深色。
 *
 * 具体配色在 style.css 的 [data-theme="dark"] 里；这里只负责算出该挂哪个值，
 * 并在系统主题变化时（自动模式下）跟着切换。
 */

const KEY = 'worddrill.theme';
const OPTIONS = ['auto', 'light', 'dark'];

function readPref() {
  try {
    const value = localStorage.getItem(KEY);
    return OPTIONS.includes(value) ? value : 'auto';
  } catch {
    return 'auto';
  }
}

/** 用户选择：auto / light / dark。 */
export function themePref() {
  return readPref();
}

const systemDark = () => {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
};

/** 实际生效的主题：light / dark。 */
export function resolvedTheme(pref = readPref()) {
  if (pref === 'dark') return 'dark';
  if (pref === 'light') return 'light';
  return systemDark() ? 'dark' : 'light';
}

function syncMeta(resolved) {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', resolved === 'dark' ? '#0e1014' : '#3f5bd9');
}

/** 把主题挂到 <html data-theme>，返回实际生效的主题。 */
export function applyTheme(pref = readPref()) {
  const resolved = resolvedTheme(pref);
  document.documentElement.dataset.theme = resolved;
  syncMeta(resolved);
  return resolved;
}

export function setThemePref(value) {
  const next = OPTIONS.includes(value) ? value : 'auto';
  try { localStorage.setItem(KEY, next); } catch { /* 忽略 */ }
  applyTheme(next);
  return next;
}

/** 自动模式下跟随系统切换。 */
export function watchSystem() {
  try {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => { if (readPref() === 'auto') applyTheme('auto'); };
    if (query.addEventListener) query.addEventListener('change', onChange);
    else if (query.addListener) query.addListener(onChange);
  } catch {
    /* 不支持就算了 */
  }
}
