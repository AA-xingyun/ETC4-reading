import { useState } from 'react';
import { formatError, parseQuestions } from './parser';
import { loadImported, saveImported, type ImportedSet } from '../practice/bank';

export interface ImportProps {
  onChanged: () => void;
}

interface Preview extends Omit<ImportedSet, 'id'> {
  id: string;
}

export function ImportPage({ onChanged }: ImportProps) {
  const [text, setText] = useState('');
  const [items, setItems] = useState<Preview[] | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const [existing, setExisting] = useState<ImportedSet[]>(loadImported());

  const parse = () => {
    setMessage('');
    const res = parseQuestions(text) as {
      items: Omit<ImportedSet, 'id'>[];
      errors: { block: number; title: string; line: number; reason: string }[];
      warnings: { block: number; title: string; line: number; reason: string }[];
    };
    setItems(res.items.map((it, i) => ({ ...it, id: `imp-${Date.now()}-${i}` })));
    setErrors(res.errors.map(formatError));
    setWarnings(res.warnings.map(formatError));
  };

  const confirm = () => {
    if (!items?.length) return;
    const list = [...loadImported(), ...items];
    saveImported(list);
    setExisting(list);
    setItems(null);
    setText('');
    setMessage(`已导入 ${items.length} 道题，去「阅读练习」就能看到。`);
    onChanged();
  };

  const remove = (id: string) => {
    const list = loadImported().filter((x) => x.id !== id);
    saveImported(list);
    setExisting(list);
    onChanged();
  };

  return (
    <section className="panel">
      <h2>粘贴导入题目</h2>
      <p className="muted">
        每题以 <code>#题目</code> 开始、<code>#结束</code> 结束（可省略）。字段：类型 / 标题 / 文章 / 题目 / 答案 / 解析。
        支持「段落匹配」和「仔细阅读」，解析后会先给预览。
      </p>

      <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={'#题目\n类型：仔细阅读\n标题：...\n文章：\n...\n题目：\n1. ...\nA. ...\n答案：\n1. B\n#结束'} />
      <div className="row gap">
        <button onClick={parse}>解析预览</button>
        <button className="ghost" onClick={() => { setText(''); setItems(null); setErrors([]); setMessage(''); }}>清空</button>
      </div>

      {message && <div className="banner ok-banner">{message}</div>}
      {!!errors.length && (
        <div className="banner">
          <b>解析失败：</b>
          <ul>{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
        </div>
      )}
      {!!warnings.length && (
        <details>
          <summary>警告 {warnings.length} 条</summary>
          <ul>{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
        </details>
      )}

      {items && (
        <div>
          <h3>预览：{items.length} 道题</h3>
          <ul className="sets">
            {items.map((item, i) => (
              <li key={item.id}>
                <div className="row wrap gap">
                  <b>{item.title || '（无标题）'}</b>
                  <span className="badge">{item.type === 'paragraph_matching' ? '段落匹配' : '仔细阅读'}</span>
                  <span className="muted small">{item.questions.length} 题</span>
                  <button className="ghost" onClick={() => setItems(items.filter((_, k) => k !== i))}>删除</button>
                </div>
              </li>
            ))}
          </ul>
          <button onClick={confirm}>确认导入 {items.length} 题</button>
        </div>
      )}

      <h3>已导入（{existing.length}）</h3>
      {!existing.length && <p className="muted">还没有导入过题目。</p>}
      <ul className="sets">
        {existing.map((item) => (
          <li key={item.id}>
            <div className="row wrap gap">
              <b>{item.title || '（无标题）'}</b>
              <span className="badge">{item.type === 'paragraph_matching' ? '段落匹配' : '仔细阅读'}</span>
              <span className="muted small">{item.questions.length} 题</span>
              <button className="ghost danger" onClick={() => remove(item.id)}>删除</button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
