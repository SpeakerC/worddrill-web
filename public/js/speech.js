/**
 * 朗读：包装浏览器的 speechSynthesis。
 * Android 版用系统 TTS，网页版用浏览器自带的语音合成，同样离线可用。
 */

let voices = [];
let warmed = false;

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
    synth.cancel();
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
