export type ReadingType = 'careful_reading' | 'paragraph_matching';
export type Difficulty = 'CET4' | 'CET6' | '考研';
export type StructuredOutputMode = 'json_schema' | 'json_object';
export type ProviderName = 'deepseek' | 'kimi' | 'qwen' | 'glm' | 'openai';
export type QuestionType = 'main_idea' | 'detail' | 'inference' | 'vocabulary';
export type DistractorKind = '①' | '②' | '③' | '④';

export interface TargetWord {
  spell: string;
  cn: string;
}

export interface GenerateParams {
  type: ReadingType;
  targetWords: TargetWord[];
  difficulty: Difficulty;
  topic: string;
  provider?: ProviderName;
}

export interface QuestionOption {
  label: string;
  text: string;
}

export interface Evidence {
  paraLabel: string;
  sentence: string;
}

export interface DistractorNote {
  label: string;
  type: string;
  note: string;
}

export interface Question {
  number: string;
  type: QuestionType;
  stem: string;
  options?: QuestionOption[];
  answer: string;
  evidence: Evidence;
  explanation: string;
  distractorNotes?: DistractorNote[] | Record<string, string>;
  testedWord?: string;
}

export interface Paragraph {
  label: string;
  text: string;
}

export interface Passage {
  type: ReadingType;
  title: string;
  difficulty: string;
  topic: string;
  passage: string;
  paragraphs: Paragraph[];
  targetWords: string[];
  questions: Question[];
  notes?: string;
  selfCheck?: Record<string, unknown>;
}

export interface ValidationReport {
  ok: boolean;
  errors: string[];
  warnings: string[];
  stats: {
    wordCount: number;
    paragraphCount: number;
    targetHitRate: number;
    targetMisses: string[];
    maxOverlap: number;
    distractorTypes: string[];
    unmatchedParagraphs: number;
  };
}

export interface GenerateMeta {
  provider: ProviderName;
  cached: boolean;
  attempt: number;
  usage: { inputTokens: number; outputTokens: number };
  validation: ValidationReport;
}

export type ApiErrorCode =
  | 'UNAUTHORIZED'
  | 'INVALID_PARAMS'
  | 'NO_PROVIDER'
  | 'RATE_LIMITED'
  | 'VALIDATION_FAILED'
  | 'GENERATION_FAILED';

export interface ApiError {
  ok: false;
  code: ApiErrorCode;
  errors?: string[];
  meta?: Record<string, unknown>;
}

export interface QueueItem {
  id: string;
  status: 'pending' | 'published';
  provider: ProviderName;
  params: GenerateParams;
  data: Passage;
  validation: ValidationReport;
  usage: { inputTokens: number; outputTokens: number };
  createdAt: number;
  publishedAt?: number;
}
