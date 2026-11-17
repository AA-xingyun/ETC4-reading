import type { GenerateMeta, Passage } from '../types';

export interface PreviewCardProps {
  data: Passage;
  meta?: GenerateMeta;
  onRefreshQueue: () => void;
  onRetry: () => void;
}

export function PreviewCard({ data, meta, onRefreshQueue, onRetry }: PreviewCardProps) {
  const validation = meta?.validation;
  return (
    <div className="preview">
      <div className="row wrap gap">
        <h3>{data.title}</h3>
        <span className="badge">{data.type === 'careful_reading' ? '仔细阅读' : '段落匹配'}</span>
        <span className="badge">{data.difficulty}</span>
        <span className="badge">provider: {meta?.provider ?? '—'}</span>
        <span className="badge">attempt: {meta?.attempt ?? 1}</span>
        <span className="badge">{meta?.cached ? '缓存命中' : `${meta?.usage.inputTokens ?? 0}+${meta?.usage.outputTokens ?? 0} tokens`}</span>
      </div>

      <div className="passage">
        {(data.paragraphs ?? []).map((p) => (
          <p key={p.label}><b>{p.label}</b> {p.text}</p>
        ))}
        {!data.paragraphs?.length && <p>{data.passage}</p>}
      </div>

      <div className="questions">
        {(data.questions ?? []).map((q) => (
          <div className="question" key={q.number}>
            <div className="stem"><b>{q.number}.</b> {q.stem} <span className="badge">{q.type}</span></div>
            {!!q.options?.length && (
              <ul className="options">
                {q.options.map((o) => (
                  <li key={o.label} className={o.label === q.answer ? 'correct' : ''}>
                    {o.label}. {o.text}
                  </li>
                ))}
              </ul>
            )}
            {!q.options?.length && <div className="muted">答案：{q.answer}</div>}
            <div className="evidence">定位：{q.evidence?.paraLabel} · “{q.evidence?.sentence}”</div>
            <div className="explain">{q.explanation}</div>
            {Array.isArray(q.distractorNotes) && (
              <ul className="notes">{q.distractorNotes.map((n) => <li key={n.label}>{n.label}｜{n.type}｜{n.note}</li>)}</ul>
            )}
            {q.testedWord && <div className="muted">考点词：{q.testedWord}</div>}
          </div>
        ))}
      </div>

      <div className={`validation ${validation?.ok ? 'ok' : 'bad'}`}>
        <h4>校验结果：{validation?.ok ? '通过' : '未通过'}</h4>
        <div className="muted">
          字数 {validation?.stats.wordCount} · 段落 {validation?.stats.paragraphCount} · 命中率{' '}
          {Math.round((validation?.stats.targetHitRate ?? 0) * 100)}% · 最大重合 {validation?.stats.maxOverlap} 词
        </div>
        {!!validation?.errors.length && (
          <ul className="errors-list">{validation.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
        )}
        {!!validation?.warnings.length && (
          <details>
            <summary>警告 {validation.warnings.length} 条（不阻断）</summary>
            <ul>{validation.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
          </details>
        )}
      </div>

      <div className="row gap">
        <button onClick={() => { onRefreshQueue(); }}>已入待发布，刷新队列</button>
        <button className="ghost" onClick={onRetry}>同参数再生成</button>
      </div>
    </div>
  );
}
