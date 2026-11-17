import { describe, expect, it } from 'vitest';
import { validatePassage } from '../server/llm/validate';
import { carefulFixture, carefulParams, matchingFixture, matchingParams } from './fixtures';

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

describe('validatePassage / careful_reading', () => {
  it('合规样本通过所有硬校验', () => {
    const report = validatePassage(carefulFixture(), carefulParams());
    expect(report.errors).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.stats.wordCount).toBeGreaterThanOrEqual(350);
    expect(report.stats.wordCount).toBeLessThanOrEqual(450);
    expect(report.stats.maxOverlap).toBeLessThanOrEqual(3);
  });

  it('字数越界报错', () => {
    const p = clone(carefulFixture());
    p.paragraphs = p.paragraphs.slice(0, 2);
    p.passage = p.paragraphs.map((x) => x.text).join('\n\n');
    const report = validatePassage(p, carefulParams());
    expect(report.ok).toBe(false);
    expect(report.errors.join('\n')).toMatch(/字数 \d+ 不在 350–450/);
  });

  it('evidence 句子不在原文时报错', () => {
    const p = clone(carefulFixture());
    p.questions[0].evidence.sentence = 'This sentence was invented and never appears in the passage.';
    const report = validatePassage(p, carefulParams());
    expect(report.ok).toBe(false);
    expect(report.errors.join('\n')).toMatch(/evidence 句子不在第 1 段原文中/);
  });

  it('正确项与定位句连续重合 5 词时报错', () => {
    const p = clone(carefulFixture());
    // 直接复制原文中连续 5 个实词
    p.questions[1].options![0].text = 'the quality of work falls before the hours do';
    const report = validatePassage(p, carefulParams());
    expect(report.ok).toBe(false);
    expect(report.errors.join('\n')).toMatch(/连续重合 \d+ 个实词/);
  });

  it('干扰项缺少某一类时报错', () => {
    const p = clone(carefulFixture());
    for (const q of p.questions) {
      const list = Array.isArray(q.distractorNotes) ? q.distractorNotes : [];
      q.distractorNotes = list.filter((n) => n.type !== '④');
    }
    const report = validatePassage(p, carefulParams());
    expect(report.ok).toBe(false);
    expect(report.errors.join('\n')).toMatch(/缺少类型 ④/);
  });

  it('词义题考点词过于基础时报错', () => {
    const p = clone(carefulFixture());
    const vocab = p.questions.find((q) => q.type === 'vocabulary')!;
    vocab.testedWord = 'sustain';
    const report = validatePassage(p, carefulParams());
    expect(report.ok).toBe(false);
    expect(report.errors.join('\n')).toMatch(/过于基础/);
  });

  it('目标词命中率不足时列出未命中词', () => {
    const params = carefulParams();
    params.targetWords = [
      ...params.targetWords,
      { spell: 'zooplankton', cn: '' },
      { spell: 'quasar', cn: '' },
      { spell: 'tectonic', cn: '' },
      { spell: 'porcelain', cn: '' },
    ];
    const report = validatePassage(carefulFixture(), params);
    expect(report.ok).toBe(false);
    const text = report.errors.join('\n');
    expect(text).toMatch(/目标词命中率 60%/);
    expect(text).toMatch(/zooplankton/);
    expect(report.stats.targetMisses).toEqual(['zooplankton', 'quasar', 'tectonic', 'porcelain']);
  });

  it('出现了未授权的目标词时报错', () => {
    const p = clone(carefulFixture());
    p.targetWords = [...p.targetWords, 'blockchain'];
    const report = validatePassage(p, carefulParams());
    expect(report.ok).toBe(false);
    expect(report.errors.join('\n')).toMatch(/未授权/);
  });
});

describe('validatePassage / paragraph_matching', () => {
  it('12 段 10 句、2 个干扰段时通过', () => {
    const report = validatePassage(matchingFixture(), matchingParams());
    expect(report.errors).toEqual([]);
    expect(report.stats.unmatchedParagraphs).toBe(2);
  });

  it('只有 1 个干扰段时报错', () => {
    const report = validatePassage(matchingFixture(11, 10), matchingParams());
    expect(report.ok).toBe(false);
    expect(report.errors.join('\n')).toMatch(/未被匹配的段落有 1 个/);
  });

  it('同一段落被匹配两次时报错', () => {
    const p = clone(matchingFixture());
    p.questions[1].answer = p.questions[0].answer;
    const report = validatePassage(p, matchingParams());
    expect(report.ok).toBe(false);
    expect(report.errors.join('\n')).toMatch(/被匹配了 2 次/);
  });

  it('段落数不足时报错', () => {
    const report = validatePassage(matchingFixture(8, 8), matchingParams(8));
    expect(report.ok).toBe(false);
    expect(report.errors.join('\n')).toMatch(/段落数 8/);
  });
});
