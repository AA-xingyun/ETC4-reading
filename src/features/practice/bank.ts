/** 题库：内置四套段落匹配 + 四套仔细阅读，加上粘贴导入的题目。 */
export interface MatchingSet {
  id: string;
  title: string;
  topic?: string;
  paragraphs: string[];
  info: { s: string; p: number }[];
  imported?: boolean;
  ai?: boolean;
}

export interface ReadingMcq {
  stem: string;
  choices: string[];
  answer: number;
  explanation?: string;
  locate?: string;
}

export interface ReadingSet {
  id: string;
  title: string;
  topic?: string;
  text: string;
  mcq: ReadingMcq[];
  imported?: boolean;
  ai?: boolean;
}

export interface ImportedSet {
  id: string;
  type: 'paragraph_matching' | 'careful_reading';
  title: string;
  passage: string;
  paragraphs: { label: string; text: string }[];
  questions: {
    number: string;
    stem: string;
    options: { label: string; text: string }[];
    answer: string;
    evidence: { paraLabel: string; sentence: string };
    explanation: string;
  }[];
}

const IMPORTED_KEY = 'reading-ai.imported.v1';
const SESSIONS_KEY = 'reading-ai.sessions.v1';

export interface Session {
  id: string;
  date: string;
  type: 'matching' | 'reading';
  title: string;
  score: number;
  total: number;
}

export async function loadBank(): Promise<{ matching: MatchingSet[]; reading: ReadingSet[] }> {
  const [m, r] = await Promise.all([
    fetch('/data/cet4_matching.json').then((x) => x.json() as Promise<MatchingSet[]>),
    fetch('/data/cet4_reading.json').then((x) => x.json() as Promise<ReadingSet[]>),
  ]);
  return { matching: m, reading: r };
}

export function loadImported(): ImportedSet[] {
  try {
    const raw = localStorage.getItem(IMPORTED_KEY);
    return raw ? (JSON.parse(raw) as ImportedSet[]) : [];
  } catch {
    return [];
  }
}

export function saveImported(list: ImportedSet[]): void {
  localStorage.setItem(IMPORTED_KEY, JSON.stringify(list));
}

/** 把导入的题目转成练习用的题组 */
export function importedToBank(list: ImportedSet[]): { matching: MatchingSet[]; reading: ReadingSet[] } {
  const matching: MatchingSet[] = [];
  const reading: ReadingSet[] = [];
  for (const item of list) {
    if (item.type === 'paragraph_matching') {
      matching.push({
        id: item.id,
        title: item.title || '导入 · 段落匹配',
        paragraphs: item.paragraphs.map((p) => p.text),
        info: item.questions.map((q) => ({
          s: q.stem,
          p: Math.max(0, item.paragraphs.findIndex((p) => p.label === q.answer)),
        })),
        imported: true,
      });
    } else {
      reading.push({
        id: item.id,
        title: item.title || '导入 · 仔细阅读',
        text: item.passage,
        mcq: item.questions.map((q) => ({
          stem: q.stem,
          choices: q.options.map((o) => o.text),
          answer: Math.max(0, q.options.findIndex((o) => o.label === q.answer)),
          explanation: q.explanation,
          locate: q.evidence?.sentence,
        })),
        imported: true,
      });
    }
  }
  return { matching, reading };
}

export function loadSessions(): Session[] {
  try {
    const raw = localStorage.getItem(SESSIONS_KEY);
    return raw ? (JSON.parse(raw) as Session[]) : [];
  } catch {
    return [];
  }
}

export function appendSession(s: Session): void {
  const list = loadSessions();
  list.unshift(s);
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(list.slice(0, 100)));
}
