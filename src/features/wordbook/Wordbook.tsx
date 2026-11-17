import { useMemo, useState } from 'react';
import { loadDictionary, lookupIn } from '../dictionary/dictionary';
import {
  addDays,
  addWord,
  calendar,
  dueWords,
  loadWordbook,
  logStudy,
  makeRound,
  markKnown,
  markUnknown,
  markWeak,
  removeWord,
  saveWordbook,
  streak,
  today,
  type RoundItem,
  type WordbookState,
} from './store';

export interface WordbookProps {
  state: WordbookState;
  onChanged: () => void;
}

type Sub = 'study' | 'review' | 'library' | 'stats';
const SUB_LABEL: Record<Sub, string> = { study: '学习', review: '复习', library: '词库', stats: '统计' };

export function Wordbook({ state, onChanged }: WordbookProps) {
  const [sub, setSub] = useState<Sub>('study');
  const [round, setRound] = useState<RoundItem[]>([]);
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [cutCount, setCutCount] = useState(0);
  const [openMeaning, setOpenMeaning] = useState<Record<string, boolean>>({});
  const [query, setQuery] = useState('');
  const [input, setInput] = useState('');
  const [batch, setBatch] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const words = Object.values(state.words).sort((a, b) => b.added.localeCompare(a.added) || a.spell.localeCompare(b.spell));
  const due = dueWords(state);
  const cutTotal = words.filter((w) => w.cut).length;
  const filtered = useMemo(
    () => words.filter((w) => !query || w.spell.includes(query.toLowerCase()) || w.cn.includes(query)),
    [words, query],
  );

  const refresh = () => onChanged();

  const startRound = () => {
    const items = makeRound(state, 10);
    setRound(items);
    setIndex(0);
    setPicked(null);
    setRevealed(false);
    setCutCount(0);
    setSub('study');
  };

  const next = () => {
    setPicked(null);
    setRevealed(false);
    setIndex((i) => i + 1);
  };

  const cut = (spell: string) => {
    const w = state.words[spell];
    if (w) {
      w.cut = true;
      w.seen += 1;
      w.right += 1;
      saveWordbook(state);
    }
    setCutCount((c) => c + 1);
    logStudy(state, 1, 1);
    next();
    refresh();
  };

  const unknown = (spell: string) => {
    markUnknown(state, spell);
    logStudy(state, 1, 0);
    setRound((list) => {
      const item = list[index];
      return [...list, item];
    });
    next();
    refresh();
  };

  const add = async () => {
    const value = input.trim();
    if (!value) return;
    setMessage('');
    setError('');
    const res = await addWord(state, value);
    if (!res.ok) {
      setError(`词典里没有「${value}」。`);
      return;
    }
    setMessage(`已加入：${res.word?.spell}`);
    setInput('');
    refresh();
  };

  const importBatch = async () => {
    const lines = batch.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return;
    const dict = await loadDictionary();
    let added = 0;
    let missing = 0;
    for (const line of lines) {
      const [head, ...rest] = line.split(/[,，\t]/);
      const spell = head.trim().split(/\s+/)[0];
      const hit = lookupIn(dict, spell);
      if (!hit) { missing += 1; continue; }
      const exists = state.words[hit.head];
      if (exists) continue;
      state.words[hit.head] = {
        spell: hit.head,
        cn: rest.join(' ').trim() || hit.trans,
        phon: hit.phon,
        added: today(),
        due: today(),
        stage: 0,
        seen: 0,
        right: 0,
        wrong: 0,
        cut: false,
      };
      added += 1;
    }
    saveWordbook(state);
    setBatch('');
    setMessage(`导入 ${added} 个，跳过词典未收录 ${missing} 个。`);
    refresh();
  };

  const resetAll = () => {
    if (!window.confirm('清空词库和统计？此操作不可撤销。')) return;
    localStorage.removeItem('reading-ai.wordbook.v1');
    const fresh = loadWordbook();
    Object.assign(state, fresh);
    refresh();
  };

  const item = round[index];

  return (
    <section className="panel">
      <div className="row wrap gap">
        <h2>单词本</h2>
        {(Object.keys(SUB_LABEL) as Sub[]).map((key) => (
          <button key={key} className={sub === key ? '' : 'ghost'} onClick={() => { setSub(key); setMessage(''); setError(''); }}>
            {SUB_LABEL[key]}
          </button>
        ))}
      </div>

      {sub === 'study' && (
        <div>
          {!round.length && (
            <div className="row gap">
              <p className="muted">复习队列优先，其次按词库顺序，抽 10 个词。答错会自动排到本轮末尾。</p>
              <button onClick={startRound}>开始本轮</button>
            </div>
          )}
          {!!round.length && index >= round.length && (
            <div className="banner ok-banner">
              本轮结束：斩了 {cutCount} 个。还剩 {due.length} 个到期词。
              <button className="ghost" onClick={startRound}>再来一轮</button>
            </div>
          )}
          {item && (
            <div className="study-card">
              <div className="row wrap gap">
                <span className="badge">{index + 1} / {round.length}</span>
                <span className="badge">已斩 {cutCount}</span>
                <span className="badge">到期 {due.length}</span>
              </div>
              <h3>{item.word.spell}</h3>
              <div className="muted">/{item.word.phon || '无音标'}/</div>
              {item.kind === 'mcq' ? (
                <div className="options">
                  {item.options.map((o) => (
                    <button
                      key={o.label}
                      className={`option ${revealed && o.label === item.answer ? 'correct' : ''} ${revealed && picked === o.label && picked !== item.answer ? 'wrong' : ''}`}
                      onClick={() => { if (!revealed) { setPicked(o.label); setRevealed(true); } }}
                    >
                      {o.label}. {o.text}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="options"><div className="muted">词库不足 4 个释义，先自评：</div></div>
              )}
              {revealed && (
                <div className="row gap">
                  <button onClick={() => cut(item.word.spell)}>斩</button>
                  <button className="ghost danger" onClick={() => unknown(item.word.spell)}>不认识</button>
                  <button
                    className="ghost danger"
                    onClick={() => {
                      if (!window.confirm('从单词本删除「' + item.word.spell + '」？')) return;
                      removeWord(state, item.word.spell);
                      setRound((list) => list.filter((x) => x.word.spell !== item.word.spell));
                      refresh();
                    }}
                  >
                    删除
                  </button>
                </div>
              )}
              {!revealed && <button className="ghost" onClick={() => setRevealed(true)}>显示答案</button>}
            </div>
          )}
        </div>
      )}

      {sub === 'review' && (
        <div>
          <p className="muted">按 1 / 2 / 4 / 7 / 15 天间隔排期；今天到期 {due.length} 个。先回想词义，再点「显示释义」对答案。</p>
          {!due.length && <p className="muted">今天没有到期的词。</p>}
          <ul className="review-list">
            {due.map((w) => (
              <li key={w.spell}>
                <div className="grow">
                  <b>{w.spell}</b> <span className="muted">/{w.phon}/</span>
                  {openMeaning[w.spell] ? (
                    <div className="meaning">{w.cn}</div>
                  ) : (
                    <button className="ghost small" onClick={() => setOpenMeaning((r) => ({ ...r, [w.spell]: true }))}>显示释义</button>
                  )}
                </div>
                <div className="row gap">
                  <button className="ghost" disabled={!openMeaning[w.spell]} onClick={() => { markKnown(state, w.spell); setOpenMeaning((r) => ({ ...r, [w.spell]: false })); refresh(); }}>认识</button>
                  <button className="ghost danger" disabled={!openMeaning[w.spell]} onClick={() => { markUnknown(state, w.spell); setOpenMeaning((r) => ({ ...r, [w.spell]: false })); refresh(); }}>不认识</button>
                  <button
                    className="ghost danger"
                    onClick={() => {
                      if (!window.confirm(`从单词本删除「${w.spell}」？`)) return;
                      removeWord(state, w.spell);
                      refresh();
                    }}
                  >
                    删除
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {sub === 'library' && (
        <div>
          <div className="row wrap gap">
            <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="输入单词，释义自动查词典" />
            <button onClick={add}>添加</button>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索单词或释义" />
            <span className="muted small">共 {words.length} 个，已斩 {cutTotal} 个</span>
          </div>
          {message && <div className="banner ok-banner">{message}</div>}
          {error && <div className="banner">{error}</div>}

          <ul className="word-list">
            {filtered.map((w) => (
              <li key={w.spell}>
                <div className="grow">
                  <b>{w.spell}</b> <span className="muted">/{w.phon}/</span>
                  {w.cut && <span className="badge">已斩</span>}
                  {w.weak && <span className="badge bad">弱词</span>}
                  <div className="muted small">{w.cn}</div>
                </div>
                <div className="row gap">
                  {!w.cut && <button className="ghost" onClick={() => { w.cut = true; saveWordbook(state); refresh(); }}>斩</button>}
                  {w.cut && <button className="ghost" onClick={() => { w.cut = false; w.stage = 0; w.due = today(); saveWordbook(state); refresh(); }}>恢复</button>}
                  <button className="ghost" onClick={() => { markWeak(state, w.spell); refresh(); }}>标弱</button>
                  <button className="ghost danger" onClick={() => { removeWord(state, w.spell); refresh(); }}>删除</button>
                </div>
              </li>
            ))}
          </ul>

          <details>
            <summary>批量导入（每行一个：word 或 word,释义）</summary>
            <textarea value={batch} onChange={(e) => setBatch(e.target.value)} placeholder={'sustain\nfatigue 疲劳'} />
            <button onClick={importBatch}>导入</button>
          </details>
        </div>
      )}

      {sub === 'stats' && (
        <div>
          <div className="row wrap gap">
            <span className="badge">词库 {words.length}</span>
            <span className="badge">已斩 {cutTotal}</span>
            <span className="badge">到期 {due.length}</span>
            <span className="badge">连续打卡 {streak(state)} 天</span>
            <button className="ghost danger" onClick={resetAll}>清空全部</button>
          </div>
          <div className="calendar">
            {calendar(state, 28).map((d) => (
              <span key={d.date} className={d.studied > 0 ? 'day on' : 'day'} title={`${d.date}：${d.studied} 词`} />
            ))}
          </div>
          <p className="muted small">最近 28 天，有颜色的表示当天学过。</p>
        </div>
      )}

      {sub === 'library' && (
        <p className="muted small">
          下次复习：{words.filter((w) => !w.cut).slice(0, 3).map((w) => `${w.spell}（${w.due}）`).join('、') || '—'}
          （今天是 {today()}，明天是 {addDays(today(), 1)}）
        </p>
      )}
    </section>
  );
}
