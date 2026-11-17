/** 单词本：学习轮次、斩词、1/2/4/7/15 天间隔复习，全部存 localStorage。 */
import { loadDictionary, lookupIn } from '../dictionary/dictionary';

export interface Word {
  spell: string;
  cn: string;
  phon: string;
  added: string;
  due: string;
  stage: number;
  seen: number;
  right: number;
  wrong: number;
  cut: boolean;
  weak?: boolean;
}

export interface DayLog {
  date: string;
  studied: number;
  cut: number;
}

export interface WordbookState {
  words: Record<string, Word>;
  log: DayLog[];
}

const KEY = 'reading-ai.wordbook.v1';
const LEGACY = 'reading-ai.library';
export const STEPS = [1, 2, 4, 7, 15];

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function loadWordbook(): WordbookState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as WordbookState;
  } catch {
    /* ignore */
  }
  // 从旧版「词库」迁移
  const state: WordbookState = { words: {}, log: [] };
  try {
    const legacy = localStorage.getItem(LEGACY);
    if (legacy) {
      const rows = JSON.parse(legacy) as { spell: string; cn: string }[];
      for (const row of rows) {
        state.words[row.spell] = {
          spell: row.spell,
          cn: row.cn,
          phon: '',
          added: today(),
          due: today(),
          stage: 0,
          seen: 0,
          right: 0,
          wrong: 0,
          cut: false,
        };
      }
      localStorage.setItem(KEY, JSON.stringify(state));
    }
  } catch {
    /* ignore */
  }
  return state;
}

export function saveWordbook(state: WordbookState): void {
  localStorage.setItem(KEY, JSON.stringify(state));
}

export async function addWord(state: WordbookState, spell: string): Promise<{ ok: boolean; word?: Word; missing?: boolean }> {
  const dict = await loadDictionary();
  const hit = lookupIn(dict, spell);
  if (!hit) return { ok: false, missing: true };
  const key = hit.head;
  const cur = state.words[key];
  if (cur) {
    if (!cur.cn) cur.cn = hit.trans;
    if (!cur.phon) cur.phon = hit.phon;
    cur.cut = false;
    saveWordbook(state);
    return { ok: true, word: cur };
  }
  const word: Word = {
    spell: key,
    cn: hit.trans,
    phon: hit.phon,
    added: today(),
    due: today(),
    stage: 0,
    seen: 0,
    right: 0,
    wrong: 0,
    cut: false,
  };
  state.words[key] = word;
  saveWordbook(state);
  return { ok: true, word };
}

export function removeWord(state: WordbookState, spell: string): void {
  delete state.words[spell];
  saveWordbook(state);
}

export function dueWords(state: WordbookState, date = today()): Word[] {
  return Object.values(state.words).filter((w) => !w.cut && w.due <= date);
}

export function nextDue(stage: number, date = today()): string {
  const step = STEPS[Math.min(stage, STEPS.length - 1)];
  return addDays(date, step);
}

export function markKnown(state: WordbookState, spell: string): void {
  const w = state.words[spell];
  if (!w) return;
  w.seen += 1;
  w.right += 1;
  w.stage = Math.min(w.stage + 1, STEPS.length - 1);
  w.due = nextDue(w.stage);
  w.cut = w.stage >= STEPS.length - 1;
  saveWordbook(state);
}

export function markUnknown(state: WordbookState, spell: string): void {
  const w = state.words[spell];
  if (!w) return;
  w.seen += 1;
  w.wrong += 1;
  w.stage = Math.max(0, w.stage - 1);
  w.due = today();
  w.cut = false;
  saveWordbook(state);
}

export function markWeak(state: WordbookState, spell: string): void {
  const w = state.words[spell];
  if (!w) return;
  w.weak = true;
  w.due = today();
  w.cut = false;
  saveWordbook(state);
}

export function logStudy(state: WordbookState, studied: number, cut: number): void {
  const date = today();
  const row = state.log.find((x) => x.date === date);
  if (row) {
    row.studied += studied;
    row.cut += cut;
  } else {
    state.log.push({ date, studied, cut });
  }
  saveWordbook(state);
}

export interface RoundItem {
  word: Word;
  kind: 'mcq' | 'self';
  options: { label: string; text: string }[];
  answer: string;
}

function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function makeRound(state: WordbookState, size = 10): RoundItem[] {
  const pool = Object.values(state.words).filter((w) => w.cn);
  const due = pool.filter((w) => !w.cut && w.due <= today());
  const rest = shuffle(pool.filter((w) => !due.includes(w)));
  const picked = [...shuffle(due), ...rest].slice(0, size);
  return picked.map((word) => {
    const others = pool.filter((w) => w.spell !== word.spell && w.cn);
    if (others.length < 3) return { word, kind: 'self' as const, options: [], answer: 'A' };
    const distractors = shuffle(others).slice(0, 3);
    const options = shuffle([word, ...distractors]).map((w, i) => ({ label: 'ABCD'[i], text: w.cn }));
    const answer = options.find((o) => o.text === word.cn)?.label ?? 'A';
    return { word, kind: 'mcq' as const, options, answer };
  });
}

export function streak(state: WordbookState): number {
  const days = new Set(state.log.filter((x) => x.studied > 0).map((x) => x.date));
  let n = 0;
  let cursor = today();
  if (!days.has(cursor)) cursor = addDays(cursor, -1);
  while (days.has(cursor)) {
    n += 1;
    cursor = addDays(cursor, -1);
  }
  return n;
}

export function calendar(state: WordbookState, days = 28): { date: string; studied: number }[] {
  const map = new Map(state.log.map((x) => [x.date, x.studied]));
  const out: { date: string; studied: number }[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const date = addDays(today(), -i);
    out.push({ date, studied: map.get(date) ?? 0 });
  }
  return out;
}
