/**
 * 代码校验层：纯函数，不读环境、不碰网络，方便单测。
 * 输入是模型输出 + 本次参数，输出 errors / warnings / stats。
 * 任一条 error 都会让这次生成被判定失败（重试或拒绝入库）。
 */
import type {
  DistractorNote,
  GenerateParams,
  Paragraph,
  Passage,
  Question,
  ValidationReport,
} from '../../shared/types.js';

export const WORD_RANGE: Record<string, [number, number]> = {
  careful_reading: [350, 450],
  paragraph_matching: [800, 1050],
};
/** prompt 里要求的目标区间，比校验口径更严；用于 warning */
export const PROMPT_WORD_TARGET: Record<string, [number, number]> = {
  careful_reading: [380, 420],
  paragraph_matching: [850, 1000],
};
/** 段落匹配：10 个待匹配句，每段最多一次，故段数 = 10 匹配 + 2~3 干扰段 */
export const MATCH_PARAGRAPHS: [number, number] = [11, 13];
export const MATCH_UNMATCHED: [number, number] = [2, 3];
export const DISTRIBUTION: Record<string, number> = {
  main_idea: 1,
  detail: 2,
  inference: 1,
  vocabulary: 1,
};
export const MAX_OVERLAP = 3;
export const TARGET_HIT_RATE = 0.8;
export const TARGET_DENSITY: [number, number] = [0.08, 0.15];

/** 四级高中基础词：这些词不能被选作词义题考点（太简单） */
export const BASIC_WORDS = new Set(
  (
    'sustain measure change focus improve increase decrease problem people work study research result reason ' +
    'effect cause method way thing time year life world city country company government school student teacher ' +
    'health money market business technology information education environment energy food water air family friend ' +
    'child woman man job house car road book word idea question answer example part number group system process ' +
    'level area point case fact view side end start need want help show find give take make get go come see know ' +
    'think say tell use live play run move turn open close long short high low big small good bad new old first ' +
    'last many much more most some all other same different early late hard easy possible sure clear'
  ).split(/\s+/),
);

const STOPWORDS = new Set(
  (
    'a an the of to in on at for with by from as and or but if then than that this these those it its is are was ' +
    'were be been being not no nor so such into over under about after before while during between within through ' +
    'also only just very more most some any each other same own such both few many much'
  ).split(/\s+/),
);

const TRANSITIONS = [
  'however', 'but', 'yet', 'in fact', 'in practice', 'what matters is', 'it is not',
];
const PREACHING = ['should', 'must', 'we need to', 'it is important to'];

/** 统一空白、引号、破折号，再做包含匹配，避免模型用弯引号被误判 */
export function normalizeText(input: string): string {
  return String(input ?? '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenize(text: string): string[] {
  return String(text ?? '').toLowerCase().match(/[a-z][a-z'-]*/g) ?? [];
}

export function stem(word: string): string {
  let w = word.toLowerCase().replace(/'s$/, '').replace(/[^a-z]/g, '');
  for (let guard = 0; guard < 3; guard += 1) {
    if (w.length > 5 && w.endsWith('ies')) w = `${w.slice(0, -3)}y`;
    else if (w.length > 5 && w.endsWith('es')) w = w.slice(0, -2);
    else if (w.length > 6 && w.endsWith('ing')) w = w.slice(0, -3);
    else if (w.length > 5 && w.endsWith('ed')) w = w.slice(0, -2);
    else if (w.length > 5 && w.endsWith('ly')) w = w.slice(0, -2);
    else if (w.length > 5 && w.endsWith('er')) w = w.slice(0, -2);
    else if (w.length > 6 && w.endsWith('est')) w = w.slice(0, -3);
    else if (w.length > 3 && w.endsWith('s')) w = w.slice(0, -1);
    else break;
  }
  return w;
}

export function contentStems(text: string): string[] {
  return tokenize(text)
    .filter((t) => !STOPWORDS.has(t))
    .map(stem)
    .filter((t) => t.length > 1);
}

/** 正确项与定位句的「最长连续重合实词数」；只数实词，避免 the same level of 之类误伤 */
export function longestOverlap(a: string, b: string): number {
  const x = contentStems(a);
  const y = contentStems(b);
  if (!x.length || !y.length) return 0;
  let best = 0;
  let prev = new Array<number>(y.length + 1).fill(0);
  for (let i = 1; i <= x.length; i += 1) {
    const cur = new Array<number>(y.length + 1).fill(0);
    for (let j = 1; j <= y.length; j += 1) {
      if (x[i - 1] === y[j - 1]) {
        cur[j] = prev[j - 1] + 1;
        if (cur[j] > best) best = cur[j];
      }
    }
    prev = cur;
  }
  return best;
}

function paragraphText(passage: Passage): string {
  if (passage.type === 'paragraph_matching') {
    return (passage.paragraphs ?? []).map((p) => p.text).join(' ');
  }
  return passage.passage || (passage.paragraphs ?? []).map((p) => p.text).join('\n\n');
}

function findParagraph(passage: Passage, label: string): Paragraph | undefined {
  const list = passage.paragraphs ?? [];
  return list.find((p) => String(p.label).toLowerCase() === String(label).toLowerCase())
    ?? list[Number(label) - 1];
}

function noteList(notes: Question['distractorNotes']): DistractorNote[] {
  if (!notes) return [];
  if (Array.isArray(notes)) return notes;
  return Object.entries(notes).map(([label, note]) => {
    const raw = String(note ?? '');
    const hit = raw.match(/[①②③④]/);
    return { label, type: hit ? hit[0] : '', note: raw };
  });
}

function distractorKinds(passage: Passage): string[] {
  const out: string[] = [];
  for (const q of passage.questions ?? []) {
    for (const note of noteList(q.distractorNotes)) {
      const hit = String(note.type || note.note).match(/[①②③④]/);
      if (hit) out.push(hit[0]);
    }
  }
  return out;
}

export function validatePassage(passage: Passage, params: GenerateParams): ValidationReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const type = passage?.type ?? params.type;
  const paragraphs = passage?.paragraphs ?? [];
  const questions = passage?.questions ?? [];
  const text = normalizeText(paragraphText(passage));
  const wordCount = tokenize(text).length;
  const inputs = (params.targetWords ?? []).map((w) => w.spell.trim().toLowerCase()).filter(Boolean);

  /* 1. 字数 */
  const [minWords, maxWords] = WORD_RANGE[type] ?? WORD_RANGE.careful_reading;
  if (wordCount < minWords || wordCount > maxWords) {
    errors.push(`字数 ${wordCount} 不在 ${minWords}–${maxWords} 区间内`);
  } else {
    const [softMin, softMax] = PROMPT_WORD_TARGET[type] ?? [minWords, maxWords];
    if (wordCount < softMin || wordCount > softMax) {
      warnings.push(`字数 ${wordCount} 略偏离 prompt 目标 ${softMin}–${softMax}`);
    }
  }

  /* 2. 段落数 */
  if (type === 'paragraph_matching') {
    if (paragraphs.length < MATCH_PARAGRAPHS[0] || paragraphs.length > MATCH_PARAGRAPHS[1]) {
      errors.push(`段落数 ${paragraphs.length} 不在 ${MATCH_PARAGRAPHS[0]}–${MATCH_PARAGRAPHS[1]} 区间内`);
    }
  } else if (paragraphs.length < 4) {
    errors.push(`仔细阅读至少 4 段，当前 ${paragraphs.length} 段`);
  }

  /* 3. 题型分布 */
  if (type === 'careful_reading') {
    const counts: Record<string, number> = {};
    for (const q of questions) counts[q.type] = (counts[q.type] ?? 0) + 1;
    for (const [kind, need] of Object.entries(DISTRIBUTION)) {
      if ((counts[kind] ?? 0) !== need) {
        errors.push(`题型分布错误：${kind} 需要 ${need} 道，实际 ${counts[kind] ?? 0} 道`);
      }
    }
    if (questions.length !== 5) errors.push(`仔细阅读必须 5 道题，当前 ${questions.length} 道`);
  }

  /* 4. 目标词命中率 + 只允许使用输入词表 */
  const declared = (passage.targetWords ?? []).map((w) => String(w).trim().toLowerCase()).filter(Boolean);
  const extra = declared.filter((w) => inputs.length && !inputs.includes(w));
  if (extra.length) errors.push(`出现了未授权的目标词：${extra.join('、')}`);
  const misses: string[] = [];
  let hits = 0;
  for (const word of inputs) {
    const re = new RegExp(`\\b${stem(word)}[a-z]{0,4}\\b`, 'i');
    if (re.test(text)) hits += 1;
    else misses.push(word);
  }
  const hitRate = inputs.length ? hits / inputs.length : 0;
  if (inputs.length && hitRate < TARGET_HIT_RATE) {
    errors.push(`目标词命中率 ${Math.round(hitRate * 100)}%，低于 80%；未命中：${misses.join('、')}`);
  }

  /* 5. 定位句真实性 */
  for (const q of questions) {
    const label = q.evidence?.paraLabel ?? '';
    const para = findParagraph(passage, label);
    const sentence = normalizeText(q.evidence?.sentence ?? '');
    if (!para) {
      errors.push(`第 ${q.number} 题的定位段落 ${label || '(空)'} 不存在`);
    } else if (!sentence) {
      errors.push(`第 ${q.number} 题缺少 evidence.sentence`);
    } else if (!normalizeText(para.text).toLowerCase().includes(sentence.toLowerCase())) {
      errors.push(`第 ${q.number} 题的 evidence 句子不在第 ${label} 段原文中`);
    }
  }

  /* 6. 正确项 paraphrase：连续重合实词 ≤ 3 */
  let maxOverlap = 0;
  if (type === 'careful_reading') {
    for (const q of questions) {
      const correct = (q.options ?? []).find((o) => o.label === q.answer);
      if (!correct) continue;
      const n = longestOverlap(correct.text, q.evidence?.sentence ?? '');
      maxOverlap = Math.max(maxOverlap, n);
      if (n > MAX_OVERLAP) {
        errors.push(`第 ${q.number} 题正确选项与定位句连续重合 ${n} 个实词（上限 ${MAX_OVERLAP}）`);
      }
    }
  }

  /* 7. 干扰项四类覆盖 */
  const kinds = distractorKinds(passage);
  const counts = new Map<string, number>();
  for (const k of kinds) counts.set(k, (counts.get(k) ?? 0) + 1);
  if (type === 'careful_reading') {
    for (const kind of ['①', '②', '③', '④']) {
      if (!counts.has(kind)) errors.push(`干扰项缺少类型 ${kind}（四类必须齐全）`);
    }
    // 5 题 × 3 个干扰项 = 15 条，四类平均 3.75 条；「同类不超过 3」不可满足，
    // 因此这里只作为质量提示，不阻断（否则任何合规输出都会被判失败）。
    for (const [kind, n] of counts) {
      if (n > 3) warnings.push(`类型 ${kind} 的干扰项有 ${n} 个，建议每类不超过 3 个`);
    }
  }

  /* 8. 词义题有效性 */
  if (type === 'careful_reading') {
    const vocab = questions.find((q) => q.type === 'vocabulary') ?? questions[4];
    if (vocab) {
      const word = String(vocab.testedWord ?? '').trim().toLowerCase();
      if (!word) errors.push('词义题缺少 testedWord');
      else if (!inputs.includes(word)) errors.push(`词义题考点词 ${word} 不在目标词表里`);
      else if (BASIC_WORDS.has(word)) errors.push(`词义题考点词 ${word} 过于基础，不能作为考点`);
    }
  }

  /* 9. 段落匹配专项 */
  let unmatched = 0;
  if (type === 'paragraph_matching') {
    if (questions.length !== 10) errors.push(`段落匹配必须 10 个待匹配句，当前 ${questions.length} 个`);
    const used = new Map<string, number>();
    for (const q of questions) {
      const label = String(q.answer ?? '').toUpperCase();
      used.set(label, (used.get(label) ?? 0) + 1);
    }
    for (const [label, n] of used) {
      if (n > 1) errors.push(`段落 ${label} 被匹配了 ${n} 次（每段最多一次）`);
      if (!paragraphs.some((p) => String(p.label).toUpperCase() === label)) {
        errors.push(`答案 ${label} 不是已有段落标签`);
      }
    }
    unmatched = paragraphs.filter((p) => !used.has(String(p.label).toUpperCase())).length;
    if (unmatched < MATCH_UNMATCHED[0] || unmatched > MATCH_UNMATCHED[1]) {
      errors.push(`未被匹配的段落有 ${unmatched} 个，必须在 ${MATCH_UNMATCHED[0]}–${MATCH_UNMATCHED[1]} 之间`);
    }
    const targetParas = questions.filter((q) => {
      const para = paragraphs.find((p) => String(p.label).toUpperCase() === String(q.answer).toUpperCase());
      return para && inputs.some((w) => new RegExp(`\\b${stem(w)}[a-z]{0,4}\\b`, 'i').test(para.text));
    }).length;
    if (targetParas < 4 || targetParas > 6) {
      warnings.push(`对应目标词段落的句子有 ${targetParas} 句，建议 4–6 句`);
    }
  }

  /* 10. 结构完整性 */
  for (const q of questions) {
    const n = q.number ?? '?';
    if (!q.stem) errors.push(`第 ${n} 题缺少题干`);
    if (!q.answer) errors.push(`第 ${n} 题缺少答案`);
    if (!q.evidence?.sentence) errors.push(`第 ${n} 题缺少 evidence`);
    if (!q.explanation) errors.push(`第 ${n} 题缺少解析`);
    if (type === 'careful_reading') {
      const options = q.options ?? [];
      if (options.length !== 4) errors.push(`第 ${n} 题需要 4 个选项，当前 ${options.length} 个`);
      if (options.length && !options.some((o) => o.label === q.answer)) {
        errors.push(`第 ${n} 题答案 ${q.answer} 不在选项里`);
      }
    }
  }

  /* 附加 warnings：密度、每词次数、转折、长句、说教口吻 */
  const targetHits = inputs.reduce((sum, w) => sum + (text.match(new RegExp(`\\b${stem(w)}[a-z]{0,4}\\b`, 'gi')) ?? []).length, 0);
  const density = wordCount ? targetHits / wordCount : 0;
  if (density < TARGET_DENSITY[0] || density > TARGET_DENSITY[1]) {
    warnings.push(`目标词密度 ${(density * 100).toFixed(1)}%，建议 8%–15%`);
  }
  for (const w of inputs) {
    const n = (text.match(new RegExp(`\\b${stem(w)}[a-z]{0,4}\\b`, 'gi')) ?? []).length;
    if (n > 2) warnings.push(`目标词 ${w} 出现了 ${n} 次，建议不超过 2 次`);
  }
  for (const [i, p] of paragraphs.entries()) {
    const low = p.text.toLowerCase();
    if (!TRANSITIONS.some((t) => low.includes(t))) warnings.push(`第 ${p.label ?? i + 1} 段没有转折词`);
  }
  for (const word of PREACHING) {
    if (new RegExp(`\\b${word}\\b`, 'i').test(text)) warnings.push(`出现说教口吻：${word}`);
  }
  const longSentences = text.split(/(?<=[.!?])\s+/).filter((s) => tokenize(s).length >= 35).length;
  if (longSentences < 2) warnings.push(`长难句只有 ${longSentences} 句，建议至少 2 句`);

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    stats: {
      wordCount,
      paragraphCount: paragraphs.length,
      targetHitRate: inputs.length ? hits / inputs.length : 0,
      targetMisses: misses,
      maxOverlap,
      distractorTypes: [...counts.keys()],
      unmatchedParagraphs: unmatched,
    },
  };
}
