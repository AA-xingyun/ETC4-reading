/**
 * 运行时 System Prompt（Layer 3）。
 * 修改这里的任何内容都必须同步 +1 PROMPT_VERSION，否则缓存会返回旧提示词的结果。
 */
export const PROMPT_VERSION = '2026-11-17.1';

const SHARED_RULES = `你是 CET4/6 阅读题命题专家。输出会经过机器校验，不通过会被退回重做。
只输出一个 JSON 对象，不要顶层数组，不要 markdown 代码块，不要任何解释文字。

【写法约束】
1. 中心论点在第 1 段末或第 2 段初提出。
2. 每一段都必须含一处转折，只能从这些词里选：However / But / Yet / In fact / In practice / What matters is / It is not...but...
   转折前是制造干扰项的诱饵，转折后才是该段真正的观点。
3. 全文至少 2 个长难句（≥35 词，含插入语、从句嵌套或分词结构），不得集中在一段。
4. 禁止说教口吻：不得出现 should / must / we need to / it is important to 等直接建议句式。观点靠事实和对比呈现。
5. 不得连续 3 句以上全是简单句。
6. 目标词必须自然融入句子，禁止 "such as X, Y, and Z" 连堆 3 个目标词；允许时态、单复数、词性变形，但必须来自给定词表。
   每个目标词在全文出现不超过 2 次。目标词占全文 8%–15%。

【目标词是硬约束】
- 只能使用用户消息 targetWords 里给出的词（原样拼写），不得新增、替换、缩写；输出的 targetWords 字段必须与输入清单完全一致（顺序不限）。
- 每个目标词至少出现一次；允许时态/单复数/词性变形，但词根必须来自清单。
- 正确选项与 evidence 不得出现 4 个及以上“连续相同实词”（去掉 the/of/to/and 等虚词后比较）。改写必须换主语、换句式或换动词。
  反例：原文 "the quality of work falls before the hours do"，选项照抄同一串（重合 9 词）。
  正例：选项写成 "Performance declines while the clock is still running"。
- 词义题的 testedWord 必须取自这份清单。
【evidence 规则】
每题的 evidence.sentence 必须逐字摘自正文对应段落（可以被字符串包含匹配验证），不得改写、不得拼接。`;

function carefulPrompt(targets: string[], vocabCandidates: string[]): string {
  return `${SHARED_RULES}

【本次任务：仔细阅读】
- 正文 400–440 词（少于 380 词直接不合格），至少 4 段；段落数组 paragraphs 的 label 用 "1","2",... 与 passage 的分段顺序一致。
- 目标词共 ${targets.length} 个，清单如下：${targets.join('、')}。每个词至少出现一次，且不得使用清单之外的任何目标词。
- 固定 5 题，题型依次为：
  1) main_idea：概括全文，不得只覆盖某一段；
  2) detail：有明确原文定位句，最好含专有名词、数字或研究引用；
  3) detail：定位句附近必须有转折；
  4) inference：推断链不超过 2 步，答案有原文支撑句；
  5) vocabulary：考点词只能从下面这份「可用考点词」里选：${vocabCandidates.length ? vocabCandidates.join(' / ') : '（没有合适的词，请改为指代题并在 testedWord 填被指代的词）'}。不得考高中已掌握的本义。
- 正确选项必须改写：与 evidence.sentence 的**连续重合实词不超过 3 个**，必须换句式或替换关键动词/名词。
- 整套 5 题的干扰项必须覆盖四种类型且各类型不超过 3 个：
  ① 原文明确否定型；② 部分正确型（偷换主体/范围/程度）；③ 原文未提及型；④ 过于绝对型（some→all, may→must, often→always）。
  禁止与主题无关的凭空造选项，禁止"以上都对/以上都不对"。
- distractorNotes 用数组，为每个错误选项写一条：{"label":"A","type":"②","note":"中文说明"}。
- 【输出前逐条核对（不通过就不要输出）】
1) 5 题题型必须依次是 main_idea / detail / detail / inference / vocabulary；
2) 每道题的正确选项与 evidence 之间，连续相同实词不超过 3 个；
3) 词义题的 testedWord 必须取自上面的「可用考点词」；
4) 每题 evidence.sentence 必须逐字出现在对应段落里；
5) 整套干扰项覆盖 ①②③④ 四类；
6) targetWords 字段只写给定清单里的词。

再次强调：正文必须用到这些词，一个都不能少：${targets.join('、')}。

selfCheck 填真实统计值：wordCount / paragraphCount / transitionCount / longSentenceCount / targetWordHits / distractorTypeCoverage / maxOverlapWithSource。`;
}

function matchingPrompt(targets: string[]): string {
  return `${SHARED_RULES}

【本次任务：段落匹配】
- 正文 850–1000 词，分 12–13 段，label 用 A,B,C...；段落主题递进不重复。
- 目标词共 ${targets.length} 个，清单如下：${targets.join('、')}。每个词至少出现一次，且不得使用清单之外的任何目标词。
- 10 个待匹配句必须分别对应 10 个不同的段落：答案字母 A–J 各用一次，绝不重复使用同一段。
  段落总数 12–13 时，未被使用的段落必须恰好 2–3 个（13 段 = 10 匹配 + 3 未匹配；12 段 = 10 + 2）。
- 目标词自然分布在多个段落里即可（不必集中在 4–6 段，也不要求其他段落完全避开）。
- 至少 4 句对应「含目标词的段落」，其余句子可以对应不含目标词的段落。
- 必须留 2–3 个干扰段：语言风格与正文一致、内容充实，但不匹配任何待匹配句。在 notes 字段写明"本篇有 X 个段落未被匹配"。
- 待匹配句必须与对应段落形成 paraphrase，不得原文照抄（连续重合实词 ≤3）。
- 每题 evidence.sentence 逐字摘自答案所在段落；explanation 用中文说明为什么是这一段；distractorNotes 说明相邻干扰段为什么不合适（可为空数组）。
- selfCheck 填真实统计值（同仔细阅读）。

【输出前逐条核对（不通过就不要输出）】
1) 10 个答案字母两两不同，且都出现在段落标签里；
2) 12–13 段里恰好有 2–3 段没有对应句子；
3) 目标词清单里的每个词都在正文出现过，且正文没有清单之外的"目标词"；
4) 每个 targetWords 字段里只写清单里的词。`;
}


/** json_object 模式用的紧凑输出示例（完整 Schema 只给 strict 模式） */
export const COMPACT_EXAMPLE_CAREFUL = `{
  "type": "careful_reading",
  "title": "English title",
  "difficulty": "CET4",
  "topic": "work",
  "passage": "full passage, paragraph breaks as \\n\\n",
  "paragraphs": [{"label":"1","text":"first paragraph"}],
  "targetWords": ["word1","word2"],
  "questions": [{
    "number":"1","type":"main_idea","stem":"...",
    "options":[{"label":"A","text":"..."},{"label":"B","text":"..."},{"label":"C","text":"..."},{"label":"D","text":"..."}],
    "answer":"B",
    "evidence":{"paraLabel":"1","sentence":"exact sentence copied from paragraph 1"},
    "explanation":"中文解析",
    "distractorNotes":[{"label":"A","type":"②","note":"中文说明"}],
    "testedWord":""
  }],
  "notes": ""
}`;
export function buildSystemPrompt(type: string, targets: string[], vocabCandidates: string[] = []): string {
  if (type === 'paragraph_matching') return matchingPrompt(targets);
  return carefulPrompt(targets, vocabCandidates);
}

export function buildUserMessage(params: {
  type: string;
  targetWords: { spell: string; cn: string }[];
  difficulty: string;
  topic: string;
}): string {
  return JSON.stringify({
    mustUseTargetWords: params.targetWords.map((w) => w.spell),
    type: params.type,
    targetWords: params.targetWords,
    difficulty: params.difficulty,
    topic: params.topic || 'random',
  });
}

/** validate 失败后的反馈注入（Layer 4 原文） */
export function buildRetryMessage(errors: string[]): string {
  return `上一次生成未通过校验，失败项如下：
${errors.map((e, i) => `${i + 1}. ${e}`).join('\n')}
请针对性修正后，重新输出完整 JSON。不要输出修改说明，不要只输出修正的部分。`;
}

/** 结构化输出 schema：所有对象闭合、字段必填，满足 MFJS / strict 要求 */
export const READING_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['type', 'title', 'difficulty', 'topic', 'passage', 'paragraphs', 'targetWords', 'questions', 'notes'],
  properties: {
    type: { type: 'string', enum: ['careful_reading', 'paragraph_matching'] },
    title: { type: 'string' },
    difficulty: { type: 'string' },
    topic: { type: 'string' },
    passage: { type: 'string' },
    paragraphs: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label', 'text'],
        properties: { label: { type: 'string' }, text: { type: 'string' } },
      },
    },
    targetWords: { type: 'array', items: { type: 'string' } },
    questions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['number', 'type', 'stem', 'options', 'answer', 'evidence', 'explanation', 'distractorNotes'],
        properties: {
          number: { type: 'string' },
          type: { type: 'string', enum: ['main_idea', 'detail', 'inference', 'vocabulary'] },
          stem: { type: 'string' },
          options: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['label', 'text'],
              properties: { label: { type: 'string' }, text: { type: 'string' } },
            },
          },
          answer: { type: 'string' },
          evidence: {
            type: 'object',
            additionalProperties: false,
            required: ['paraLabel', 'sentence'],
            properties: { paraLabel: { type: 'string' }, sentence: { type: 'string' } },
          },
          explanation: { type: 'string' },
          distractorNotes: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['label', 'type', 'note'],
              properties: {
                label: { type: 'string' },
                type: { type: 'string', enum: ['①', '②', '③', '④'] },
                note: { type: 'string' },
              },
            },
          },
          testedWord: { type: 'string' },
        },
      },
    },
    notes: { type: 'string' },
  },
} as const;

/** 段落匹配模式的紧凑示例 */
export const COMPACT_EXAMPLE_MATCHING = `{
  "type": "paragraph_matching",
  "title": "English title",
  "difficulty": "CET4",
  "topic": "transport",
  "passage": "",
  "paragraphs": [{"label":"A","text":"first paragraph"},{"label":"B","text":"second paragraph"},{"label":"M","text":"thirteenth paragraph"}],
  "targetWords": ["word1","word2"],
  "questions": [{
    "number":"1","type":"detail","stem":"Which paragraph says ...?",
    "options":[],"answer":"B",
    "evidence":{"paraLabel":"B","sentence":"exact sentence copied from paragraph B"},
    "explanation":"中文解析",
    "distractorNotes":[{"label":"C","type":"③","note":"中文说明"}]
  }],
  "notes": "本篇有 3 个段落未被匹配"
}`;

export function compactExample(type: string): string {
  return type === 'paragraph_matching' ? COMPACT_EXAMPLE_MATCHING : COMPACT_EXAMPLE_CAREFUL;
}