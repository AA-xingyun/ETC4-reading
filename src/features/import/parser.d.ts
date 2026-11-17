export interface ParseIssue {
  block: number;
  title: string;
  line: number;
  reason: string;
}

export interface ParsedQuestion {
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

export function parseQuestions(text: string): {
  items: ParsedQuestion[];
  errors: ParseIssue[];
  warnings: ParseIssue[];
};

export function formatError(issue: ParseIssue): string;
