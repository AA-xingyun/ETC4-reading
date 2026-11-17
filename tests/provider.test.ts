import { describe, expect, it } from 'vitest';
import { buildRequest, chatURL, normalizeBaseURL, parseResponse, type ProviderConfig } from '../server/llm/provider';
import { READING_SCHEMA } from '../server/llm/prompts';

const jsonObjectProvider: ProviderConfig = {
  name: 'deepseek',
  baseURL: 'https://api.deepseek.com',
  apiKey: 'sk-test',
  model: 'deepseek-chat',
  structuredOutput: 'json_object',
  supportsStrictSchema: false,
  maxTokens: 8192,
  temperature: 0.8,
};

const jsonSchemaProvider: ProviderConfig = {
  ...jsonObjectProvider,
  name: 'kimi',
  baseURL: 'https://api.moonshot.cn/v1/',
  structuredOutput: 'json_schema',
  supportsStrictSchema: true,
  model: 'kimi-k3.1-pro',
};

describe('buildRequest', () => {
  it('json_schema 模式使用 strict + schema', () => {
    const req = buildRequest(jsonSchemaProvider, 'SYS', 'USER', READING_SCHEMA) as any;
    expect(req.response_format.type).toBe('json_schema');
    expect(req.response_format.json_schema.strict).toBe(true);
    expect(req.response_format.json_schema.schema).toEqual(READING_SCHEMA);
    expect(req.messages[0].content).toBe('SYS');
  });

  it('json_object 模式把 schema 示例塞进 system，并要求出现 json 字样', () => {
    const req = buildRequest(jsonObjectProvider, 'SYS', 'USER', READING_SCHEMA) as any;
    expect(req.response_format.type).toBe('json_object');
    const system = req.messages[0].content as string;
    expect(system).toContain('json');
    expect(system).toContain('JSON Schema 示例');
    expect(system).toContain('"paragraphs"');
    expect(system).toContain('"questions"');
  });
});

describe('URL 归一化', () => {
  it('去掉尾部斜杠并补 chat/completions', () => {
    expect(normalizeBaseURL('https://api.moonshot.cn/v1/')).toBe('https://api.moonshot.cn/v1');
    expect(chatURL('https://api.deepseek.com')).toBe('https://api.deepseek.com/chat/completions');
    expect(chatURL('https://open.bigmodel.cn/api/paas/v4/')).toBe('https://open.bigmodel.cn/api/paas/v4/chat/completions');
  });
});

describe('parseResponse', () => {
  it('空内容报错（DeepSeek JSON mode 可能返回空白）', () => {
    const r = parseResponse({ choices: [{ message: { content: '   ' } }] });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/空内容/);
  });

  it('finish_reason=length 视为截断', () => {
    const r = parseResponse({ choices: [{ message: { content: '{"a":1}' }, finish_reason: 'length' }] });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/截断/);
  });

  it('解析合法 JSON，并兼容 fenced 输出', () => {
    const r = parseResponse({ choices: [{ message: { content: '```json\n{"a":1}\n```' } }], usage: { prompt_tokens: 3, completion_tokens: 4 } });
    expect(r.ok).toBe(true);
    expect(r.parsed).toEqual({ a: 1 });
    expect(r.usage).toEqual({ inputTokens: 3, outputTokens: 4 });
  });

  it('JSON 解析失败返回错误而不是抛异常', () => {
    const r = parseResponse({ choices: [{ message: { content: '{oops' } }] });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/JSON 解析失败/);
  });
});
