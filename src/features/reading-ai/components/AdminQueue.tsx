import { useState } from 'react';
import type { QueueRow } from '../api/generateReading';

export interface AdminQueueProps {
  items: QueueRow[];
  onRefresh: () => void;
  onPublish: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

export function AdminQueue({ items, onRefresh, onPublish, onDelete }: AdminQueueProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const act = async (id: string, fn: (id: string) => Promise<void>) => {
    setBusyId(id);
    try {
      await fn(id);
      await onRefresh();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="panel">
      <div className="row gap">
        <h2>待发布队列（{items.filter((i) => i.status === 'pending').length}）</h2>
        <button className="ghost" onClick={onRefresh}>刷新</button>
      </div>
      <p className="muted">这是你自己的审核队列（单机应用没有第二个审核人）：先看一遍生成结果，确认没问题点「发布」，它才会出现在「阅读练习」的题库里；不想要就直接删除。</p>

      {!items.length && <p className="muted">队列为空。</p>}

      <ul className="queue">
        {items.map((item) => (
          <li key={item.id} className={item.status === 'published' ? 'published' : ''}>
            <div className="row wrap gap">
              <b>{item.data.title || '(无标题)'}</b>
              <span className="badge">{item.data.type === 'careful_reading' ? '仔细阅读' : '段落匹配'}</span>
              <span className="badge">{item.provider}</span>
              <span className={`badge ${item.validation?.ok ? 'ok' : 'bad'}`}>
                校验 {item.validation?.ok ? '通过' : '未通过'}
              </span>
              <span className="badge">{item.status === 'published' ? '已发布' : '待发布'}</span>
              <span className="muted small">{new Date(item.createdAt).toLocaleString()}</span>
            </div>
            <div className="row gap">
              <button className="ghost" onClick={() => setOpenId(openId === item.id ? null : item.id)}>
                {openId === item.id ? '收起' : '查看'}
              </button>
              {item.status === 'pending' && (
                <button disabled={busyId === item.id} onClick={() => act(item.id, onPublish)}>发布</button>
              )}
              <button className="ghost danger" disabled={busyId === item.id} onClick={() => act(item.id, onDelete)}>删除</button>
            </div>
            {openId === item.id && (
              <div className="queue-detail">
                {(item.data.paragraphs ?? []).map((p) => (
                  <p key={p.label}><b>{p.label}</b> {p.text}</p>
                ))}
                <ol>
                  {(item.data.questions ?? []).map((q) => (
                    <li key={q.number}>
                      {q.stem}
                      <div className="muted small">答案 {q.answer} · 定位 {q.evidence?.paraLabel} · {q.evidence?.sentence}</div>
                    </li>
                  ))}
                </ol>
                {!!item.validation?.warnings?.length && (
                  <details>
                    <summary>警告 {item.validation.warnings.length} 条</summary>
                    <ul>{item.validation.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
                  </details>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
