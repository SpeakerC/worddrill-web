import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  normalizeWord,
  coreGloss,
  posUnits,
  posMatch,
  damerauLevenshtein,
  orthoScore,
  glossScore,
  isAmbiguous,
  isValidWord,
  isValidEntry,
  pickDistractors,
} from '../public/js/confuse.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);

function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const entry = (w, pos, m) => ({ word: w, pos, meaning: m });

test('归一化与核心释义', () => {
  assert.equal(normalizeWord('  Adapt  '), 'adapt');
  assert.equal(normalizeWord('oˈclock'), "o'clock");
  assert.equal(normalizeWord('Egypt*'), 'egypt');
  assert.equal(coreGloss('n. 苹果'), '苹果');
  assert.equal(coreGloss('vt.&vi. 把…分类，拣选'), '把分类拣选');
  assert.equal(coreGloss('（美）颜色'), '颜色');
  assert.equal(coreGloss('a. 好的；健康的'), '好健康');
});

test('词性归一', () => {
  assert.deepEqual([...posUnits('vt.&vi.')], ['v']);
  assert.deepEqual([...posUnits('a.&ad.')], ['a', 'ad']);
  assert.equal(posMatch('n.', 'n.&v.'), 1);
  assert.equal(posMatch('n.', 'v.'), 0);
  assert.equal(posMatch('', ''), 0.5);
  assert.equal(posMatch('n.', ''), 0.35);
});

test('Damerau-Levenshtein 支持相邻交换', () => {
  assert.equal(damerauLevenshtein('ab', 'ba'), 1);
  assert.equal(damerauLevenshtein('adapt', 'adopt'), 1);
  assert.equal(damerauLevenshtein('', 'abc'), 3);
});

test('形近分：形近词明显高于无关词', () => {
  const adaptAdopt = orthoScore('adapt', 'adopt');
  const adaptApple = orthoScore('adapt', 'apple');
  assert.ok(adaptAdopt > 0.75, `adapt/adopt=${adaptAdopt}`);
  assert.ok(adaptApple < 0.5, `adapt/apple=${adaptApple}`);
  assert.ok(orthoScore('affect', 'effect') > 0.7);
  assert.ok(orthoScore('protect', 'protest') > 0.8);
  assert.equal(orthoScore('adapt', 'adapt'), 1);
  // 同词性有加分
  assert.ok(orthoScore(entry('adapt', 'v.', '适应'), entry('adopt', 'v.', '采用')) > adaptAdopt);
});

test('释义相似与同义判定', () => {
  const save = glossScore('保护', '保存');
  assert.ok(save > 0.15 && save < 0.5, `保护/保存=${save}`);
  assert.equal(glossScore('保护', '保护'), 1);
  assert.ok(glossScore('保护', '防止') < 0.1);

  assert.equal(isAmbiguous('适应', '适应，改编本'), true);
  assert.equal(isAmbiguous('保护', '保存'), false);
  assert.equal(isAmbiguous('获得', '获得'), true);
  assert.equal(isAmbiguous('把…分类，拣选', '分类'), true);
});

test('坏词形不能进选项', () => {
  assert.equal(isValidWord('v]'), false);
  assert.equal(isValidWord('soft sɔft;'), false);
  assert.equal(isValidWord('Egypt*'), false);
  assert.equal(isValidWord('café'), true);
  assert.equal(isValidWord('Lost & Found'), true);
  assert.equal(isValidWord("o'clock"), true);
  assert.equal(isValidEntry({ word: 'v]', meaning: '分类' }), false);
  assert.equal(isValidEntry({ word: 'sort', meaning: '种类' }), true);
  assert.equal(isValidEntry({ w: 'sort', m: '种类' }), true);
});

test('看汉选英：形近词优先，同义派生词排除', () => {
  const correct = entry('adapt', 'v.', '适应，改编');
  const pool = [
    correct,
    entry('adopt', 'v.', '采用，收养'),
    entry('adept', 'a.', '熟练的'),
    entry('adaptation', 'n.', '适应，改编本'),
    entry('apple', 'n.', '苹果'),
    entry('apply', 'v.', '申请'),
    entry('adequate', 'a.', '足够的'),
  ];
  let hit = 0;
  for (let seed = 0; seed < 40; seed += 1) {
    const picked = pickDistractors(correct, pool, 'zh_en', { rng: seeded(seed) });
    assert.equal(picked.length, 3, `seed ${seed}`);
    assert.ok(!picked.some((p) => p.word === 'adapt'), '不能包含正确答案');
    assert.ok(!picked.some((p) => p.word === 'adaptation'), '同义派生词要排除');
    if (picked.some((p) => p.word === 'adopt' || p.word === 'adept')) hit += 1;
  }
  assert.ok(hit >= 30, `形近词命中 ${hit}/40`);
});

test('看英选汉：不拿同义词的释义当干扰项', () => {
  const correct = entry('obtain', 'v.', '获得');
  const pool = [
    correct,
    entry('gain', 'v.', '获得'),
    entry('acquire', 'v.', '获得'),
    entry('attain', 'v.', '获得'),
    entry('apple', 'n.', '苹果'),
    entry('apply', 'v.', '申请'),
    entry('adopt', 'v.', '采用'),
  ];
  const picked = pickDistractors(correct, pool, 'en_zh', { rng: seeded(3) });
  assert.equal(picked.length, 3);
  for (const p of picked) {
    assert.ok(!['gain', 'acquire', 'attain'].includes(p.word), `混进了同义词 ${p.word}`);
    assert.ok(!isAmbiguous(correct.meaning, p.meaning));
  }
});

test('选项数量不足时按可用数量返回', () => {
  const correct = entry('adapt', 'v.', '适应');
  const one = pickDistractors(correct, [correct, entry('adopt', 'v.', '采用')], 'zh_en', { rng: seeded(1) });
  assert.equal(one.length, 1);
  const none = pickDistractors(correct, [correct], 'zh_en', { rng: seeded(1) });
  assert.deepEqual(none, []);
});

test('默写 / 听音拼写没有选项', () => {
  const correct = entry('adapt', 'v.', '适应');
  assert.deepEqual(pickDistractors(correct, [correct, entry('adopt', 'v.', '采用')], 'spell'), []);
  assert.deepEqual(pickDistractors(correct, [correct, entry('adopt', 'v.', '采用')], 'listen'), []);
});

test('真实词表：选项合法、不重复、不与正确答案同义', () => {
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'assets', 'words3500.json'), 'utf8'));
  const pool = raw.map((e) => ({ word: e.w, pos: e.pos, meaning: e.m }));
  const samples = pool.filter((_, i) => i % 137 === 0).slice(0, 24);

  for (const correct of samples) {
    for (const mode of ['en_zh', 'zh_en']) {
      const picked = pickDistractors(correct, pool, mode, { rng: seeded(7), count: 3 });
      assert.equal(picked.length, 3, `${correct.word} / ${mode}`);
      const seen = new Set();
      for (const p of picked) {
        assert.ok(isValidEntry(p), `${p.word} 不是合法词条`);
        assert.notEqual(normalizeWord(p.word), normalizeWord(correct.word));
        assert.ok(!isAmbiguous(correct.meaning, p.meaning), `${correct.word} 的选项 ${p.word} 与正确答案同义`);
        const key = mode === 'en_zh' ? coreGloss(p.meaning) : normalizeWord(p.word);
        assert.ok(!seen.has(key), `${correct.word} / ${mode} 选项重复：${p.word}`);
        seen.add(key);
      }
    }
  }
});