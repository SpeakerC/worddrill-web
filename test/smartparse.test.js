import { test } from 'node:test';
import assert from 'node:assert';

import { splitText, smartParse } from '../public/js/smartparse.js';

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

const OK_BODY = {
  ok: true,
  markdown: '| 英文 | 词性 | 汉语 |\n| --- | --- | --- |\n| abandon | v. | 放弃 |',
  count: 1,
  truncated: false,
};

test('splitText 按行分块，每块不超过上限', () => {
  const chunks = splitText('alpha 阿尔法\nbeta 贝塔\ngamma 伽马', 14);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => chunk.length <= 14));
  assert.equal(chunks.join('\n').replace(/\n+/g, '\n'), 'alpha 阿尔法\nbeta 贝塔\ngamma 伽马');
});

test('splitText 不切断普通行，超长行才硬切', () => {
  const chunks = splitText('short\nabcdefghij', 6);
  assert.deepEqual(chunks, ['short', 'abcdef', 'ghij']);
  assert.deepEqual(splitText('', 10), []);
});

test('smartParse 依次串行请求，合并结果并按小写去重', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push(JSON.parse(options.body).text);
    return response(200, {
      ok: true,
      markdown: [
        '| 英文 | 词性 | 汉语 |',
        '| --- | --- | --- |',
        '| Apple | n. | 苹果 |',
        '| ability | n. | 能力 |',
      ].join('\n'),
      count: 2,
      truncated: false,
    });
  };

  const data = await smartParse('Apple 苹果\nability 能力\napple 苹果（重复）', {
    fetchImpl,
    endpoints: ['https://example.test/api'],
    maxChars: 20,
  });

  assert.equal(calls.length, 2);
  assert.deepEqual(data.entries.map((e) => e.word), ['Apple', 'ability']);
  assert.equal(data.count, 2);
  assert.equal(data.chunks, 2);
  assert.ok(!('exampleEn' in data.entries[0]), 'AI 在线转换不应生成例句');
});

test('smartParse 遇到 502 会换回退地址', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.includes('primary')) return response(502, { ok: false, error: '上游超时' });
    return response(200, OK_BODY);
  };

  const data = await smartParse('abandon 放弃', {
    fetchImpl,
    endpoints: ['https://primary.test/api', 'https://backup.test/api'],
  });

  assert.deepEqual(calls, ['https://primary.test/api', 'https://backup.test/api']);
  assert.equal(data.entries[0].word, 'abandon');
});

test('smartParse 遇到 422 直接报错，不继续试回退地址', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return response(422, { ok: false, error: '没有整理出任何词条' });
  };

  await assert.rejects(
    smartParse('这不是词汇表', {
      fetchImpl,
      endpoints: ['https://primary.test/api', 'https://backup.test/api'],
    }),
    /没有整理出任何词条/,
  );
  assert.equal(calls, 1);
});

test('smartParse 连不上时给出可读错误', async () => {
  const fetchImpl = async () => {
    throw new TypeError('fetch failed');
  };

  await assert.rejects(
    smartParse('abandon 放弃', {
      fetchImpl,
      endpoints: ['https://primary.test/api'],
    }),
    /连不上 AI 服务/,
  );
});

test('smartParse 空结果报错，truncated 会汇总', async () => {
  const empty = async () => response(200, { ok: true, markdown: '| 英文 | 词性 | 汉语 |', count: 0, truncated: true });
  await assert.rejects(
    smartParse('nothing', { fetchImpl: empty, endpoints: ['https://example.test/api'] }),
    /没有整理出词条/,
  );

  const truncated = await smartParse('abandon 放弃', {
    fetchImpl: async () => response(200, { ...OK_BODY, truncated: true }),
    endpoints: ['https://example.test/api'],
  });
  assert.equal(truncated.truncated, true);
});