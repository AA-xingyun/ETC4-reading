import { useEffect, useMemo, useState } from 'react';
import { lookup, type DictEntry } from '../dictionary/dictionary';
import {
  appendSession,
  importedToBank,
  loadBank,
  loadImported,
  type MatchingSet,
  type ReadingSet,
} from './bank';

export interface PracticeProps {
  onAddWord: (spell: string) => Promise<{ ok: boolean; missing?: boolean }>;
}

type Session =
  | { type: 'matching'; set: MatchingSet; answers: Record<number, number>; submitted: boolean; score: number }
  | { type: 'reading'; set: ReadingSet; answers: Record<number, number>; submitted: boolean; score: number };

const LETTER = (i: number) => String.fromCharCode(65 + i);

function ClickableWords({ text, onPick }: { text: string; onPick: (w: string) => void }) {
  const parts = text.split(/([A-Za-z][A-Za-z'’-]*)/g);
  return (
    <span>
      {parts.map((part, i) =>
        /^[A-Za-z]/.test(part) ? (
          <button key={i} className="word" onClick={() => onPick(part)}>{part}</button>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </span>
  );
}

export function Practice({ onAddWord }: PracticeProps) {
  const [bank, setBank] = useState<{ matching: MatchingSet[]; reading: ReadingSet[] }>({ matching: [], reading: [] });
  const [published, setPublished] = useState<{ matching: MatchingSet[]; reading: ReadingSet[] }>({ matching: [], reading: [] });
  const [type, setType] = useState<'matching' | 'reading'>('matching');
  const [session, setSession] = useState<Session | null>(null);
  const [popup, setPopup] = useState<{ word: string; entry: DictEntry | null; message?: string } | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    loadBank()
      .then((built) => {
        const imported = importedToBank(loadImported());
        setBank({
          matching: [...built.matching, ...imported.matching],
          reading: [...built.reading, ...imported.reading],
        });
      })
      .catch((err) => setError((err as Error).message));
  }, []);

  // 审核通过（发布）的 AI 题目才会进题库
  useEffect(() => {
    fetch('/api/queue')
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((body: { items?: any[] }) => {
        const published = (body.items ?? []).filter((i) => i.status === 'published');
        const m: MatchingSet[] = [];
        const rd: ReadingSet[] = [];
        for (const item of published) {
          const d = item.data ?? {};
          if (d.type === 'paragraph_matching') {
            const paragraphs = (d.paragraphs ?? []).map((p: any) => p.text);
            m.push({
              id: item.id,
              title: d.title || 'AI · 段落匹配',
              paragraphs,
              ai: true,
              info: (d.questions ?? []).map((q: any) => ({
                s: q.stem,
                p: Math.max(0, (d.paragraphs ?? []).findIndex((p: any) => p.label === q.answer)),
              })),
              imported: true,
            });
          } else {
            rd.push({
              id: item.id,
              title: d.title || 'AI · 仔细阅读',
              text: d.passage || (d.paragraphs ?? []).map((p: any) => p.text).join('\n\n'),
              ai: true,
              mcq: (d.questions ?? []).map((q: any) => ({
                stem: q.stem,
                choices: (q.options ?? []).map((o: any) => o.text),
                answer: Math.max(0, (q.options ?? []).findIndex((o: any) => o.label === q.answer)),
                explanation: q.explanation,
                locate: q.evidence?.sentence,
              })),
              imported: true,
            });
          }
        }
        setPublished({ matching: m, reading: rd });
      })
      .catch(() => undefined);
  }, []);

  const openWord = async (word: string) => {
    setPopup({ word, entry: null });
    const entry = await lookup(word);
    setPopup({ word, entry });
  };

  const addWord = async (word: string) => {
    const hit = await lookup(word);
    if (!hit) {
      setPopup({ word, entry: null, message: '词典里没有这个词。' });
      return;
    }
    const res = await onAddWord(hit.head);
    setPopup({ word, entry: hit, message: res.ok ? '已加入单词本。' : '加入失败。' });
  };

  const start = (item: MatchingSet | ReadingSet, kind: 'matching' | 'reading') => {
    setSession(
      kind === 'matching'
        ? { type: 'matching', set: item as MatchingSet, answers: {}, submitted: false, score: 0 }
        : { type: 'reading', set: item as ReadingSet, answers: {}, submitted: false, score: 0 },
    );
  };

  const submit = () => {
    if (!session) return;
    let score = 0;
    if (session.type === 'matching') {
      session.set.info.forEach((row, i) => { if (session.answers[i] === row.p) score += 1; });
    } else {
      session.set.mcq.forEach((q, i) => { if (session.answers[i] === q.answer) score += 1; });
    }
    const total = session.type === 'matching' ? session.set.info.length : session.set.mcq.length;
    appendSession({
      id: `${Date.now()}`,
      date: new Date().toISOString().slice(0, 10),
      type: session.type,
      title: session.set.title,
      score,
      total,
    });
    setSession({ ...session, submitted: true, score });
  };

  const total = useMemo(() => {
    if (!session) return 0;
    return session.type === 'matching' ? session.set.info.length : session.set.mcq.length;
  }, [session]);

  if (session) {
    const submitted = session.submitted;
    return (
      <section className="panel">
        <div className="row wrap gap">
          <button className="ghost" onClick={() => setSession(null)}>← 返回题库</button>
          <h2>{session.set.title}</h2>
          <span className="badge">{session.type === 'matching' ? '段落匹配' : '仔细阅读'}</span>
          {submitted && <span className="badge ok">得分 {session.score} / {total}</span>}
        </div>
        <p className="muted">点文中任意单词可查释义并加入单词本。</p>

        {session.type === 'reading' ? (
          session.set.text.split(/\n{2,}/).map((para, i) => (
            <p key={i}><ClickableWords text={para} onPick={openWord} /></p>
          ))
        ) : (
          session.set.paragraphs.map((para, i) => (
            <p key={i}><b>{LETTER(i)}</b> <ClickableWords text={para} onPick={openWord} /></p>
          ))
        )}

        <div className="questions">
          {session.type === 'matching'
            ? session.set.info.map((row, i) => {
              const correct = row.p;
              const chosen = session.answers[i];
              return (
                <div className="question" key={i}>
                  <div className="stem"><b>{i + 1}.</b> {row.s}</div>
                  <select
                    disabled={submitted}
                    value={chosen ?? ''}
                    onChange={(e) => setSession({ ...session, answers: { ...session.answers, [i]: Number(e.target.value) } })}
                  >
                    <option value="">选择段落…</option>
                    {session.set.paragraphs.map((_, k) => <option key={k} value={k}>{LETTER(k)}</option>)}
                  </select>
                  {submitted && (
                    <div className={`feedback ${chosen === correct ? 'ok' : 'bad'}`}>
                      {chosen === correct ? '正确' : `正确答案：${LETTER(correct)}`}
                    </div>
                  )}
                </div>
              );
            })
            : session.set.mcq.map((q, i) => {
              const chosen = session.answers[i];
              return (
                <div className="question" key={i}>
                  <div className="stem"><b>{i + 1}.</b> {q.stem}</div>
                  <ul className="options">
                    {q.choices.map((c, k) => (
                      <li key={k} className={submitted && k === q.answer ? 'correct' : submitted && k === chosen ? 'wrong' : ''}>
                        <label>
                          <input
                            type="radio"
                            name={`q${i}`}
                            disabled={submitted}
                            checked={chosen === k}
                            onChange={() => setSession({ ...session, answers: { ...session.answers, [i]: k } })}
                          />{' '}
                          {LETTER(k)}. {c}
                        </label>
                      </li>
                    ))}
                  </ul>
                  {submitted && q.locate && <div className="evidence">定位：{q.locate}</div>}
                  {submitted && q.explanation && <div className="explain">{q.explanation}</div>}
                </div>
              );
            })}
        </div>

        {!submitted ? (
          <button className="btn" onClick={submit}>交卷</button>
        ) : (
          <div className="row gap">
            <button className="ghost" onClick={() => setSession(null)}>返回题库</button>
            <button onClick={() => start(session.set, session.type)}>再做一次</button>
          </div>
        )}

        {popup && (
          <div className="modal" onClick={() => setPopup(null)}>
            <div className="modal-box" onClick={(e) => e.stopPropagation()}>
              <div className="row gap">
                <b>{popup.word}</b>
                <span className="muted">{popup.entry ? `/${popup.entry.phon}/` : '词典未收录'}</span>
              </div>
              <p>{popup.entry ? popup.entry.trans : '没有找到释义。'}</p>
              {popup.message && <div className="banner ok-banner">{popup.message}</div>}
              <div className="row gap">
                <button disabled={!popup.entry} onClick={() => addWord(popup.word)}>加入单词本</button>
                <button className="ghost" onClick={() => setPopup(null)}>关闭</button>
              </div>
            </div>
          </div>
        )}
      </section>
    );
  }

  const mergedMatching = [...bank.matching, ...published.matching];
  const mergedReading = [...bank.reading, ...published.reading];
  const list = type === 'matching' ? mergedMatching : mergedReading;
  return (
    <section className="panel">
      <div className="row wrap gap">
        <h2>阅读练习</h2>
        <button className={type === 'matching' ? '' : 'ghost'} onClick={() => setType('matching')}>段落匹配（{mergedMatching.length}）</button>
        <button className={type === 'reading' ? '' : 'ghost'} onClick={() => setType('reading')}>仔细阅读（{mergedReading.length}）</button>
      </div>
      <p className="muted">
        {type === 'matching'
          ? '每篇十段（A–J）配十条信息：为每条信息选出对应段落，同一段可能被选中多次。'
          : '每篇五道四选一：先看题干，答案必须来自文章。'}
      </p>
      {error && <div className="banner">{error}</div>}
      <ul className="sets">
        {list.map((item) => (
          <li key={item.id}>
            <div className="row wrap gap">
              <b>{item.title}</b>
              {item.topic && <span className="badge">{item.topic}</span>}
              {item.ai && <span className="badge ok">AI · 已发布</span>}
              {!item.ai && item.imported && <span className="badge">导入</span>}
              <span className="muted small">
                {(item as MatchingSet).info?.length ?? (item as ReadingSet).mcq?.length} 题
              </span>
              <button onClick={() => start(item, type)}>开始</button>
            </div>
          </li>
        ))}
        {!list.length && <li className="muted">还没有题组。</li>}
      </ul>
    </section>
  );
}
