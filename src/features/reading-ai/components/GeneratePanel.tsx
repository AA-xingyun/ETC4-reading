import { useMemo, useState } from 'react';
import type { Difficulty, ProviderName, ReadingType } from '../types';
import type { ProviderInfo } from '../api/generateReading';
import { useGenerateReading } from '../hooks/useGenerateReading';
import { PreviewCard } from './PreviewCard';

export interface LibWord {
  spell: string;
  cn: string;
  status: 'new' | 'learning' | 'mastered';
}

export interface GeneratePanelProps {
  providers: ProviderInfo[];
  words: LibWord[];
  onQueued: () => void;
}

const RANGE: Record<ReadingType, [number, number]> = {
  careful_reading: [8, 15],
  paragraph_matching: [15, 30],
};

const STATUS_LABEL: Record<LibWord['status'], string> = { new: '未学', learning: '在学', mastered: '已掌握' };

export function GeneratePanel({ providers, words, onQueued }: GeneratePanelProps) {
  const [type, setType] = useState<ReadingType>('careful_reading');
  const [difficulty, setDifficulty] = useState<Difficulty>('CET4');
  const [topic, setTopic] = useState('random');
  const [provider, setProvider] = useState<ProviderName | ''>(providers[0]?.name ?? '');
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | LibWord['status']>('all');
  const { state, start, cancel, reset } = useGenerateReading();

  const visible = useMemo(
    () => words.filter((w) => (filter === 'all' || w.status === filter) && (!query || w.spell.includes(query.toLowerCase()))),
    [words, filter, query],
  );
  const chosen = words.filter((w) => selected[w.spell]);
  const [min, max] = RANGE[type];
  const outside = chosen.length > 0 && (chosen.length < min || chosen.length > max);
  const busy = state.status === 'running';

  const args = () => ({
    type,
    difficulty,
    topic: topic.trim() || 'random',
    provider: provider || undefined,
    targetWords: chosen.map((w) => ({ spell: w.spell, cn: w.cn })),
  });

  const run = () => {
    if (!providers.length) return;
    if (!chosen.length) return;
    start(args());
  };

  const retryWithFewer = () => {
    const keep = chosen.slice(0, Math.max(min, Math.min(chosen.length, 8)));
    setSelected(Object.fromEntries(keep.map((w) => [w.spell, true])));
    start({ ...args(), targetWords: keep.map((w) => ({ spell: w.spell, cn: w.cn })) });
  };

  const retryWithOtherProvider = () => {
    const idx = providers.findIndex((p) => p.name === provider);
    const next = providers[(idx + 1) % providers.length];
    if (!next) return;
    setProvider(next.name);
    start({ ...args(), provider: next.name });
  };

  return (
    <section className="panel">
      <h2>用这些词生成一篇阅读</h2>
      <p className="muted">下面这些词来自「单词本 → 词库」。生成结果先进入「待发布」队列；你在那里点「发布」之后，它才会出现在「阅读练习」里。</p>

      <div className="row wrap gap">
        <label>题型
          <select value={type} onChange={(e) => setType(e.target.value as ReadingType)}>
            <option value="careful_reading">仔细阅读（5 题）</option>
            <option value="paragraph_matching">段落匹配（10 句）</option>
          </select>
        </label>
        <label>难度
          <select value={difficulty} onChange={(e) => setDifficulty(e.target.value as Difficulty)}>
            <option value="CET4">CET4</option>
            <option value="CET6">CET6</option>
            <option value="考研">考研</option>
          </select>
        </label>
        <label>主题
          <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="random 或具体主题" />
        </label>
        <label>Provider
          <select value={provider} onChange={(e) => setProvider(e.target.value as ProviderName)}>
            {providers.map((p) => <option key={p.name} value={p.name}>{p.name} · {p.model}</option>)}
          </select>
        </label>
      </div>

      <div className="row wrap gap">
        <input className="grow" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索单词" />
        <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
          <option value="all">全部状态</option>
          <option value="new">未学</option>
          <option value="learning">在学</option>
          <option value="mastered">已掌握</option>
        </select>
        <button className="ghost" onClick={() => setSelected({})}>清空选择</button>
        <button className="ghost" onClick={() => setSelected(Object.fromEntries(visible.map((w) => [w.spell, true])))}>全选当前</button>
      </div>

      <div className="word-grid">
        {visible.map((w) => (
          <label key={w.spell} className={`word-chip ${selected[w.spell] ? 'on' : ''}`}>
            <input type="checkbox" checked={!!selected[w.spell]} onChange={(e) => setSelected((s) => ({ ...s, [w.spell]: e.target.checked }))} />
            <span>{w.spell}</span>
            <small>{STATUS_LABEL[w.status]}</small>
          </label>
        ))}
        {!visible.length && <p className="muted">没有匹配的词。</p>}
      </div>

      <p className="muted">
        已选 <b>{chosen.length}</b> 个。建议 {min}–{max} 个
        {outside ? `（当前不在建议区间，仍可继续）` : ''}
        {providers.length ? '' : '。未配置任何 Provider，生成入口不可用。'}
      </p>

      {busy && (
        <div className="progress">
          <div className="bar"><i style={{ width: `${state.progress}%` }} /></div>
          <div className="row gap">
            <span className="muted">生成中… 约 30–90 秒</span>
            <button className="ghost" onClick={cancel}>取消</button>
          </div>
        </div>
      )}

      <div className="row gap">
        <button disabled={busy || !chosen.length || !providers.length} onClick={run}>生成</button>
        {state.status !== 'idle' && !busy && <button className="ghost" onClick={reset}>清除结果</button>}
      </div>

      {state.status === 'error' && (
        <div className="errors">
          <h3>生成失败{state.code ? `（${state.code}）` : ''}</h3>
          <ul>{(state.error ?? '').split('\n').filter(Boolean).map((e, i) => <li key={i}>{e}</li>)}</ul>
          <div className="row gap">
            <button onClick={run}>带反馈重试</button>
            <button className="ghost" onClick={retryWithFewer}>减少目标词再试</button>
            {providers.length > 1 && <button className="ghost" onClick={retryWithOtherProvider}>换个模型重试</button>}
          </div>
        </div>
      )}

      {state.status === 'done' && state.response?.data && (
        <PreviewCard
          data={state.response.data}
          meta={state.response.meta}
          onRefreshQueue={onQueued}
          onRetry={run}
        />
      )}
    </section>
  );
}
