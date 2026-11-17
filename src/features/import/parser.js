/* 粘贴导入题目：把「#题目 … #结束」的文本解析成题目对象。
   纯函数，不碰 DOM，浏览器和 Node 都能用。错误信息带题号与行号。 */
// 从旧项目移植的解析器（原样保留逻辑；此处关掉严格类型检查）
/* eslint-disable */
// @ts-nocheck
export function createParser() {
  'use strict';

  const FIELD = /^(类型|标题|文章|题目|答案|解析)\s*[:：]\s*(.*)$/;
  const ALIASES = {
    paragraph_matching: ['段落匹配', '长篇阅读', '匹配题', '段落信息匹配', '长篇阅读匹配'],
    careful_reading: ['仔细阅读', '阅读理解', '选择题', '单项选择', '四选一'],
  };

  function normalize(s) {
    return String(s == null ? '' : s)
      .replace(/[\uFF01-\uFF5E]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
      .replace(/\u3000/g, ' ');
  }

  function typeOf(raw) {
    const t = normalize(raw).trim();
    if (!t) return null;
    for (const [type, names] of Object.entries(ALIASES)) {
      if (names.some((n) => t.indexOf(n) !== -1)) return type;
    }
    return 'unknown';
  }

  const TYPE_LABEL = { paragraph_matching: '段落匹配', careful_reading: '仔细阅读' };

  /* ---------- 切块 ---------- */

  function splitBlocks(text) {
    const lines = normalize(text).replace(/\r\n?/g, '\n').split('\n');
    const blocks = [];
    let cur = null;
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i].trim();
      if (/^#\s*题目\s*$/.test(t)) {
        if (cur) blocks.push(cur);
        cur = { startLine: i + 1, lines: [] };
        continue;
      }
      if (/^#\s*结束\s*$/.test(t)) {
        if (cur) { cur.endLine = i + 1; blocks.push(cur); cur = null; }
        continue;
      }
      if (cur) cur.lines.push({ no: i + 1, text: lines[i] });
    }
    if (cur) blocks.push(cur);
    return blocks;
  }

  // 字段名之后的连续行都归这个字段，直到下一个字段名。
  function sectionsOf(block) {
    const out = {};
    let cur = null;
    for (const { no, text } of block.lines) {
      const t = text.trim();
      const m = t.match(FIELD);
      if (m) {
        cur = { name: m[1], line: no, items: [] };
        out[m[1]] = cur;
        if (m[2].trim()) cur.items.push({ no, text: m[2].trim() });
        continue;
      }
      if (cur) cur.items.push({ no, text });
    }
    return out;
  }

  /* ---------- 各字段 ---------- */

  function parseParagraphs(items) {
    const list = [];
    for (const { no, text } of items) {
      const t = normalize(text).trim();
      if (!t) continue;
      let m = t.match(/^\[\s*([A-Za-z])\s*\]\s*(.*)$/)
        || t.match(/^([A-Za-z])\s*[.、:：]\s*(.*)$/)
        || t.match(/^([A-Za-z])\s*[)）]\s*(.*)$/);
      if (m) {
        list.push({ label: m[1].toUpperCase(), text: (m[2] || '').trim(), line: no });
      } else if (list.length) {
        list[list.length - 1].text = (list[list.length - 1].text + ' ' + t).trim();
      } else {
        list.push({ label: '', text: t, line: no });
      }
    }
    return list;
  }

  function parseQuestionList(items, type) {
    const out = [];
    let cur = null;
    let lastWasOption = false;
    const QSTART = /^(?:\(|（)?\s*(\d{1,5})\s*(?:[.、)）:：]\s*|\s+)(.+)$/;
    const OPTION = /^([A-Za-z])\s*[.、)）:：]\s*(.+)$/;
    for (const { no, text } of items) {
      const t = normalize(text).trim();
      if (!t) continue;
      let m;
      if (type === 'careful_reading' && cur && (m = t.match(OPTION))) {
        cur.options.push({ label: m[1].toUpperCase(), text: m[2].trim(), line: no });
        lastWasOption = true;
        continue;
      }
      if ((m = t.match(QSTART))) {
        cur = { number: m[1], stem: m[2].trim(), options: [], line: no };
        out.push(cur);
        lastWasOption = false;
        continue;
      }
      if (!cur) continue;
      if (lastWasOption && cur.options.length) cur.options[cur.options.length - 1].text += ' ' + t;
      else cur.stem = (cur.stem + ' ' + t).trim();
    }
    return out;
  }

  function parseAnswers(items) {
    const map = {};
    const lineOf = {};
    for (const { no, text } of items) {
      const t = normalize(text).trim();
      if (!t) continue;
      const re = /(\d{1,5})\s*[.、)）:：]?\s*([A-Za-z]+)/g;
      let m;
      while ((m = re.exec(t))) {
        map[m[1]] = m[2].toUpperCase();
        lineOf[m[1]] = no;
      }
    }
    return { map, lineOf };
  }

  function parseExplanation(items) {
    const per = {};
    let whole = '';
    for (const { text } of items) {
      const t = normalize(text).trim();
      if (!t) continue;
      const m = t.match(/^(\d{1,5})\s*[.、)）:：]\s*(.+)$/);
      if (m) per[m[1]] = m[2].trim();
      else whole = (whole + ' ' + t).trim();
    }
    return { per, whole };
  }

  /* ---------- 一题 ---------- */

  function parseBlock(block, index) {
    const errors = [];
    const warnings = [];
    const sections = sectionsOf(block);
    const titleSec = sections['标题'];
    const title = titleSec && titleSec.items.length ? normalize(titleSec.items[0].text).trim() : '';
    const label = (title || ('第 ' + index + ' 题')) ;
    const push = (line, reason) => errors.push({ block: index, title: label, line: line || block.startLine, reason });

    const typeSec = sections['类型'];
    if (!typeSec || !typeSec.items.length) {
      push(block.startLine, '缺少「类型：」，请写段落匹配或仔细阅读');
      return { errors, warnings, item: null };
    }
    const type = typeOf(typeSec.items[0].text);
    if (type === 'unknown') {
      push(typeSec.line, '未知题型「' + normalize(typeSec.items[0].text).trim() + '」，只支持段落匹配 / 仔细阅读');
      return { errors, warnings, item: null };
    }
    if (!type) {
      push(typeSec.line, '「类型：」后面是空的');
      return { errors, warnings, item: null };
    }

    const passageSec = sections['文章'];
    const passageLines = passageSec ? passageSec.items.filter((x) => normalize(x.text).trim()) : [];
    if (!passageLines.length) push(passageSec ? passageSec.line : block.startLine, '文章是空的');
    const passage = passageLines.map((x) => normalize(x.text)).join('\n').trim();

    let paragraphs = [];
    if (type === 'paragraph_matching') {
      paragraphs = parseParagraphs(passageLines);
      const noLabel = paragraphs.filter((p) => !p.label);
      if (passage && !paragraphs.length) push(passageSec.line, '文章里没有段落标记（如 [A]）');
      else if (noLabel.length) push(noLabel[0].line, '段落缺少 [A] 这样的标记');
      const seen = {};
      for (const p of paragraphs) {
        if (!p.label) continue;
        if (seen[p.label]) push(p.line, '段落标记 ' + p.label + ' 重复');
        seen[p.label] = true;
      }
    }

    const questionSec = sections['题目'];
    if (!questionSec || !questionSec.items.some((x) => normalize(x.text).trim())) {
      push(questionSec ? questionSec.line : block.startLine, '题目是空的');
    }
    const questions = questionSec ? parseQuestionList(questionSec.items, type) : [];
    if (questionSec && !questions.length) push(questionSec.line, '题目区里没有识别到带编号的题目（如 36. …）');

    const numberSeen = {};
    for (const q of questions) {
      if (numberSeen[q.number]) push(q.line, '题号 ' + q.number + ' 重复');
      numberSeen[q.number] = true;
      if (!q.stem) push(q.line, '第 ' + q.number + ' 题没有题干');
      if (type === 'careful_reading') {
        if (q.options.length < 2) push(q.line, '第 ' + q.number + ' 题只有 ' + q.options.length + ' 个选项，至少需要 2 个');
        else if (q.options.length < 4) warnings.push({ block: index, title: label, line: q.line, reason: '第 ' + q.number + ' 题只有 ' + q.options.length + ' 个选项，四级通常是 4 个' });
        const seen = {};
        for (const o of q.options) {
          if (seen[o.label]) push(o.line, '第 ' + q.number + ' 题的选项 ' + o.label + ' 重复');
          seen[o.label] = true;
        }
      }
    }

    const answerSec = sections['答案'];
    const answers = answerSec ? parseAnswers(answerSec.items) : { map: {}, lineOf: {} };
    if (!answerSec || !answerSec.items.some((x) => normalize(x.text).trim())) {
      push(answerSec ? answerSec.line : block.startLine, '缺少「答案：」');
    } else if (!Object.keys(answers.map).length) {
      push(answerSec.line, '答案区里没有识别到「36. A」这样的答案');
    }

    const explainSec = sections['解析'];
    const explain = explainSec ? parseExplanation(explainSec.items) : { per: {}, whole: '' };

    if (passageLines.length && questions.length) {
      const nums = questions.map((q) => q.number);
      const missing = nums.filter((n) => !answers.map[n]);
      const extra = Object.keys(answers.map).filter((n) => nums.indexOf(n) === -1);
      if (missing.length) push(answers.lineOf[nums[0]] || (answerSec && answerSec.line) || block.startLine, '这些题号没有答案：' + missing.join('、'));
      if (extra.length) push(answers.lineOf[extra[0]] || block.startLine, '答案里有多余的题号：' + extra.join('、'));
      if (type === 'careful_reading') {
        for (const q of questions) {
          const a = answers.map[q.number];
          if (!a) continue;
          const labels = q.options.map((o) => o.label);
          if (labels.indexOf(a) === -1) push(q.line, '第 ' + q.number + ' 题答案 ' + a + ' 不在选项 ' + labels.join('/') + ' 里');
        }
      } else {
        const labels = paragraphs.map((p) => p.label);
        for (const q of questions) {
          const a = answers.map[q.number];
          if (!a) continue;
          if (a.length !== 1) push(q.line, '第 ' + q.number + ' 题答案应该是单个段落字母，现在是 ' + a);
          else if (labels.indexOf(a) === -1) push(q.line, '第 ' + q.number + ' 题答案 ' + a + ' 不在段落标记 ' + labels.join('') + ' 里');
        }
      }
    }

    if (errors.length) return { errors, warnings, item: null };

    const item = {
      type,
      title,
      passage,
      paragraphs: type === 'paragraph_matching' ? paragraphs.map((p) => ({ label: p.label, text: p.text })) : [],
      questions: questions.map((q) => ({
        number: q.number,
        stem: q.stem,
        options: q.options.map((o) => ({ label: o.label, text: o.text })),
        answer: answers.map[q.number],
        explanation: explain.per[q.number] || '',
      })),
      explanation: explain.whole || '',
      raw: '',
    };
    return { errors, warnings, item };
  }

  /* ---------- 对外 ---------- */

  function parseQuestions(text) {
    const raw = String(text || '');
    const blocks = splitBlocks(raw);
    if (!blocks.length) {
      return {
        items: [],
        errors: [{ block: 0, title: '', line: 1, reason: '没有找到「#题目」开头的题目块' }],
        warnings: [],
      };
    }
    const items = [];
    const errors = [];
    const warnings = [];
    blocks.forEach((block, i) => {
      const res = parseBlock(block, i + 1);
      errors.push(...res.errors);
      warnings.push(...res.warnings);
      if (res.item) {
        res.item.raw = raw.split('\n').slice(block.startLine - 1, (block.endLine || block.startLine) ).join('\n');
        items.push(res.item);
      }
    });
    return { items, errors, warnings };
  }

  function formatError(e) {
    const head = e.block ? '第 ' + e.block + ' 个题目' : '文本';
    const title = e.title ? '（' + e.title + '）' : '';
    return head + title + ' 第 ' + e.line + ' 行：' + e.reason;
  }

  return { parseQuestions, formatError, normalize, typeOf, splitBlocks, TYPE_LABEL };
}

export const { parseQuestions, formatError } = createParser();
