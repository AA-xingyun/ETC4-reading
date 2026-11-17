import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  deleteItem,
  fetchProviders,
  fetchQueue,
  publishItem,
  type ProviderInfo,
  type QueueRow,
} from '@features/reading-ai/api/generateReading';
import { AdminQueue } from '@features/reading-ai/components/AdminQueue';
import { GeneratePanel, type LibWord } from '@features/reading-ai/components/GeneratePanel';
import { SettingsPanel } from '@features/reading-ai/components/SettingsPanel';
import { Practice } from '@features/practice/Practice';
import { Progress } from '@features/practice/Progress';
import { ImportPage } from '@features/import/ImportPage';
import { Wordbook } from '@features/wordbook/Wordbook';
import { addWord, loadWordbook, type WordbookState } from '@features/wordbook/store';

type Tab = 'practice' | 'wordbook' | 'import' | 'queue' | 'progress';

const TABS: { id: Tab; label: string }[] = [
  { id: 'practice', label: '阅读练习' },
  { id: 'wordbook', label: '单词本' },
  { id: 'import', label: '导入题目' },
  { id: 'queue', label: '待发布' },
  { id: 'progress', label: '进度' },
];

export default function App() {
  const [tab, setTab] = useState<Tab>('practice');
  const [providers, setProviders] = useState<ProviderInfo[]>([]);

  const [book, setBook] = useState<WordbookState>(() => loadWordbook());
  const [queue, setQueue] = useState<QueueRow[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [error, setError] = useState('');

  const refreshProviders = useCallback(async () => {
    try {
      const info = await fetchProviders();
      setProviders(info.providers);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  const refreshQueue = useCallback(async () => {
    try {
      setQueue(await fetchQueue());
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  const refreshBook = useCallback(() => setBook(loadWordbook()), []);

  const addToBook = useCallback(async (spell: string) => {
    const res = await addWord(book, spell);
    refreshBook();
    return { ok: res.ok, missing: res.missing };
  }, [book, refreshBook]);

  useEffect(() => {
    refreshProviders();
    refreshQueue();
  }, [refreshProviders, refreshQueue]);

  const words: LibWord[] = useMemo(
    () =>
      Object.values(book.words).map((w) => ({
        spell: w.spell,
        cn: w.cn,
        status: w.cut ? 'mastered' : w.seen > 0 ? 'learning' : 'new',
      })),
    [book],
  );

  return (
    <div className="app">
      <header>
        <h1>CET-4 阅读 · 单词本 · AI 出题</h1>
        <nav>
          {TABS.map((t) => (
            <button key={t.id} className={tab === t.id ? '' : 'ghost'} onClick={() => setTab(t.id)}>
              {t.label}
              {t.id === 'queue' && queue.filter((q) => q.status === 'pending').length
                ? `（${queue.filter((q) => q.status === 'pending').length}）`
                : ''}
            </button>
          ))}
        </nav>
        <div className="meta">
          <button className="ghost" onClick={() => setSettingsOpen(true)}>设置</button>
        </div>
      </header>

      {error && <div className="banner">{error}</div>}

      {tab === 'practice' && <Practice onAddWord={addToBook} />}

      {tab === 'wordbook' && (
        <>
          <Wordbook state={book} onChanged={refreshBook} />
          {/* 词库页底部的生成入口；没有 Provider 时整体隐藏 */}
          {providers.length > 0 && <GeneratePanel providers={providers} words={words} onQueued={refreshQueue} />}
        </>
      )}

      {tab === 'import' && <ImportPage onChanged={() => undefined} />}

      {tab === 'queue' && (
        <AdminQueue
          items={queue}
          onRefresh={refreshQueue}
          onPublish={async (id) => { await publishItem(id); }}
          onDelete={async (id) => { await deleteItem(id); }}
        />
      )}

      {tab === 'progress' && <Progress />}

      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} onChanged={refreshProviders} />}
    </div>
  );
}
