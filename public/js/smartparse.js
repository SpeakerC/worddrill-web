/**
 * 智能解析接口客户端（实验性）。
 *
 * 把任意词表交给服务端整理成「英文 | 词性 | 汉语」三列，再按现有的
 * Markdown 词表解析规则入库。接口文档：
 *   POST https://api.zzlltt.xyz/api/smart-parse
 *
 * 注意：AI 只整理原文，不生成例句，所以转换后的词条没有 exampleEn / exampleZh。
 */
import { parseMarkdown } from './vocab.js';

export const ENDPOINTS = [
  'https://api.zzlltt.xyz/api/smart-parse',
  'https://worddrill-vercel.vercel.app/api/smart-parse',
  'https://worddrill-ai.netlify.app/api/smart-parse',
];

/** 接口单次上限 3000 字；按文档建议切到 600 字一段，模型不容易截断，也更快。 */
export const MAX_CHUNK_CHARS = 600;
export const REQUEST_TIMEOUT_MS = 15000;

class SmartParseError extends Error {
  constructor(message, { status = 0, retryable = false, cause = null } = {}) {
    super(message);
    this.name = 'SmartParseError';
    this.status = status;
    this.retryable = retryable;
    this.cause = cause;
  }
}

function normalizeText(text) {
  return String(text == null ? '' : text).replace(/\r\n?/g, '\n').trim();
}

/**
 * 按行切成不超过 max 字的块，尽量不切断一行（一行太长时才硬切）。
 * @returns {string[]}
 */
export function splitText(text, max = MAX_CHUNK_CHARS) {
  const normalized = normalizeText(text);
  if (!normalized) return [];
  const limit = Math.max(1, Math.trunc(max) || MAX_CHUNK_CHARS);
  const chunks = [];
  let current = '';

  const flush = () => {
    if (current) {
      chunks.push(current);
      current = '';
    }
  };

  for (const line of normalized.split('\n')) {
    if (line.length > limit) {
      flush();
      for (let i = 0; i < line.length; i += limit) chunks.push(line.slice(i, i + limit));
      continue;
    }
    if (current && current.length + 1 + line.length > limit) flush();
    current = current ? `${current}\n${line}` : line;
  }
  flush();
  return chunks;
}

function isAbortError(err) {
  return err && (err.name === 'AbortError' || err.code === 'ABORT_ERR');
}

function statusMessage(status) {
  if (status === 400) return '粘贴内容为空或格式不对';
  if (status === 405) return 'AI 接口不接受这个请求方式';
  if (status === 413) return '这一段太长了，请分段后再试';
  if (status === 422) return 'AI 没有整理出词条，确认粘贴的是词汇表';
  if (status === 429) return 'AI 服务繁忙或额度用完了，稍后再试';
  if (status === 502) return 'AI 服务暂时不可用，稍后重试';
  return status ? `AI 整理失败（HTTP ${status}）` : 'AI 整理失败';
}

function retryableStatus(status) {
  return status === 429 || status === 502 || status === 0;
}

/** 请求一段文本；失败时抛 SmartParseError，便于上层决定换地址还是直接报错。 */
async function requestChunk(url, text, { fetchImpl = globalThis.fetch, timeoutMs = REQUEST_TIMEOUT_MS, signal } = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new SmartParseError('当前环境不支持网络请求');
  }
  if (signal && signal.aborted) {
    throw new SmartParseError('已取消');
  }

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const forwardAbort = () => controller.abort();
  if (signal) signal.addEventListener('abort', forwardAbort, { once: true });

  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: controller.signal,
    });

    let data = null;
    try {
      data = await res.json();
    } catch {
      // 非 JSON 响应按服务异常处理，下面统一报错
    }

    if (!res.ok) {
      const detail = data && typeof data.error === 'string' && data.error.trim()
        ? data.error.trim()
        : '';
      throw new SmartParseError(detail || statusMessage(res.status), {
        status: res.status,
        retryable: retryableStatus(res.status),
      });
    }
    if (!data || data.ok !== true || typeof data.markdown !== 'string') {
      throw new SmartParseError('AI 返回的内容不完整', { status: res.status, retryable: true });
    }
    return data;
  } catch (err) {
    if (err instanceof SmartParseError) throw err;
    if (isAbortError(err)) {
      if (signal && signal.aborted) throw new SmartParseError('已取消');
      if (timedOut) {
        throw new SmartParseError('AI 整理超时，稍后重试', { status: 0, retryable: true, cause: err });
      }
      throw new SmartParseError('AI 整理已中断', { status: 0, retryable: true, cause: err });
    }
    throw new SmartParseError('连不上 AI 服务，检查网络后重试', {
      status: 0,
      retryable: true,
      cause: err,
    });
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', forwardAbort);
  }
}

/** 依次尝试三个地址；429 时短等一次再换下一个。 */
async function requestWithFallback(text, options = {}) {
  const endpoints = options.endpoints || ENDPOINTS;
  let last = null;
  for (let i = 0; i < endpoints.length; i += 1) {
    try {
      return await requestChunk(endpoints[i], text, options);
    } catch (err) {
      last = err;
      if (!(err instanceof SmartParseError)) throw err;
      if (options.signal && options.signal.aborted) throw err;
      if (!err.retryable) throw err;
      if (err.status === 429 && i < endpoints.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 800));
      }
    }
  }
  throw last || new SmartParseError('AI 整理失败');
}

/**
 * 在线整理词表。逐段串行请求，按小写去重，返回可直接入库的词条。
 *
 * @param {string} text 原始词表文本
 * @param {object} [options]
 * @param {(progress: {done: number, total: number, count: number}) => void} [options.onProgress]
 * @param {AbortSignal} [options.signal]
 * @param {typeof fetch} [options.fetchImpl] 测试注入
 * @param {string[]} [options.endpoints]
 * @param {number} [options.maxChars] 分块字数，默认 600（测试用）
 * @returns {Promise<{entries: object[], count: number, chunks: number, truncated: boolean}>}
 */
export async function smartParse(text, options = {}) {
  const chunks = splitText(text, options.maxChars);
  if (!chunks.length) throw new SmartParseError('先粘贴要整理的词表');

  const entries = [];
  const seen = new Set();
  let truncated = false;

  for (let i = 0; i < chunks.length; i += 1) {
    if (options.signal && options.signal.aborted) throw new SmartParseError('已取消');
    const data = await requestWithFallback(chunks[i], options);
    truncated = truncated || Boolean(data.truncated);
    const parsed = parseMarkdown(data.markdown);
    for (const entry of parsed) {
      const key = entry.word.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push(entry);
    }
    if (options.onProgress) {
      options.onProgress({ done: i + 1, total: chunks.length, count: entries.length });
    }
  }

  if (!entries.length) {
    throw new SmartParseError('AI 没有整理出词条，确认粘贴的是词汇表');
  }
  return { entries, count: entries.length, chunks: chunks.length, truncated };
}