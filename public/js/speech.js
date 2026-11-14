/**
 * 朗读：包装浏览器的 speechSynthesis。
 * Android 版用系统 TTS，网页版用浏览器自带的语音合成，同样离线可用。
 */

let voices = [];
let warmed = false;
let primed = false;

export function supported() {
  return typeof window !== 'undefined'
    && 'speechSynthesis' in window
    && typeof window.SpeechSynthesisUtterance === 'function';
}

function loadVoices() {
  if (!supported()) return voices;
  try {
    voices = window.speechSynthesis.getVoices() || [];
  } catch {
    voices = [];
  }
  return voices;
}

function pickVoice() {
  if (!voices.length) loadVoices();
  const english = voices.filter((voice) => /^en([-_]|$)/i.test(voice.lang || ''));
  if (!english.length) return null;
  return english.find((voice) => /en[-_]US/i.test(voice.lang)) || english[0];
}

/** 第一次进入时预热：有些浏览器要等 voiceschanged 才有声音可选。 */
export function warmup() {
  if (!supported() || warmed) return;
  warmed = true;
  loadVoices();
  try {
    window.speechSynthesis.addEventListener('voiceschanged', () => loadVoices());
  } catch {
    /* 老浏览器没有事件，忽略 */
  }
  // 浏览器语音引擎要等第一次 speak 才真正启动。页面加载时先静音试一次；
  // 移动端若必须等用户手势，onerror 会复位，这些监听会再补一次。
  // 不用 once：预热若因浏览器策略没启动，下一次点按还能重试。
  prime();
  for (const event of ['pointerdown', 'keydown']) {
    window.addEventListener(event, prime, { passive: true });
  }
}

/**
 * 静音预热语音引擎。必须由用户手势触发（移动端不允许页面自动发声）。
 * 只做一次；失败就退回未预热，不影响正常朗读。
 */
export function prime() {
  if (!supported() || primed) return;
  primed = true;
  let started = false;
  try {
    const synth = window.speechSynthesis;
    if (synth.speaking || synth.pending) { primed = false; return; }
    const utterance = new window.SpeechSynthesisUtterance('a');
    utterance.volume = 0;
    utterance.rate = 2;
    utterance.lang = 'en-US';
    const voice = pickVoice();
    if (voice) utterance.voice = voice;
    utterance.onstart = () => { started = true; };
    utterance.onerror = () => { primed = false; };
    synth.speak(utterance);
    // 有些浏览器既不报错也不开始（等手势），1.5 秒后允许重试
    setTimeout(() => { if (!started) primed = false; }, 1500);
  } catch {
    primed = false;
  }
}

/**
 * 朗读一段英文。返回错误说明；成功时返回空字符串。
 * 音色优先选英语语音，没有也照常读（只是可能带口音）。
 */
export function speak(text, options = {}) {
  if (!supported()) return '当前浏览器不支持朗读';
  const clean = String(text == null ? '' : text).trim();
  if (!clean) return '';
  try {
    const synth = window.speechSynthesis;
    if (synth.paused) synth.resume();
    // 没有在播时不要 cancel：Chrome/Edge 的 cancel 本身会拖慢下一句起播
    if (synth.speaking || synth.pending) synth.cancel();
    const utterance = new window.SpeechSynthesisUtterance(clean);
    const voice = pickVoice();
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang;
    } else {
      utterance.lang = 'en-US';
    }
    utterance.rate = options.rate || 0.92;
    utterance.pitch = 1;
    synth.speak(utterance);
    return '';
  } catch (err) {
    return `朗读失败：${err.message || err}`;
  }
}
