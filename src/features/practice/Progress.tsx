import { useState } from 'react';
import { loadSessions } from './bank';

export function Progress() {
  const [sessions] = useState(loadSessions());
  const total = sessions.reduce((n, s) => n + s.total, 0);
  const right = sessions.reduce((n, s) => n + s.score, 0);
  const byType = {
    matching: sessions.filter((s) => s.type === 'matching'),
    reading: sessions.filter((s) => s.type === 'reading'),
  };

  return (
    <section className="panel">
      <h2>进度</h2>
      <div className="row wrap gap">
        <span className="badge">练习 {sessions.length} 次</span>
        <span className="badge">答题 {total} 道</span>
        <span className="badge">正确率 {total ? Math.round((right / total) * 100) : 0}%</span>
        <span className="badge">段落匹配 {byType.matching.length} 次</span>
        <span className="badge">仔细阅读 {byType.reading.length} 次</span>
      </div>

      {!sessions.length && <p className="muted">还没有练习记录。去「阅读练习」做一篇。</p>}
      <ul className="sets">
        {sessions.map((s) => (
          <li key={s.id}>
            <div className="row wrap gap">
              <span className="muted small">{s.date}</span>
              <span className="badge">{s.type === 'matching' ? '段落匹配' : '仔细阅读'}</span>
              <b>{s.title}</b>
              <span className={s.score / s.total >= 0.6 ? 'badge ok' : 'badge bad'}>{s.score} / {s.total}</span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
