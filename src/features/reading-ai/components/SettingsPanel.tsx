import { useEffect, useState } from 'react';
import type { ProviderName } from '../types';
import {
  clearProviderKey,
  fetchSettings,
  saveProviderKey,
  testProviderConnection,
  type ProviderSetting,
} from '../api/generateReading';

export interface SettingsPanelProps {
  onClose: () => void;
  onChanged: () => void;
}

const NAMES: ProviderName[] = ['deepseek', 'kimi', 'qwen', 'glm', 'openai'];

export function SettingsPanel({ onClose, onChanged }: SettingsPanelProps) {
  const [list, setList] = useState<ProviderSetting[]>([]);
  const [provider, setProvider] = useState<ProviderName>('deepseek');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [baseURL, setBaseURL] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const current = list.find((p) => p.name === provider);

  const reload = async () => {
    try {
      const items = await fetchSettings();
      setList(items);
      const hit = items.find((p) => p.name === provider);
      if (hit) { setModel(hit.model); setBaseURL(hit.baseURL); }
    } catch (err) {
      setError((err as Error).message);
    }
  };

  useEffect(() => { reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [provider]);

  const save = async () => {
    setBusy(true); setError(''); setMessage('');
    try {
      const out = await saveProviderKey({ provider, apiKey: apiKey || undefined, model: model || undefined, baseURL: baseURL || undefined });
      if (!out.ok) { setError((out.errors ?? ['保存失败']).join('；')); return; }
      setApiKey('');
      setMessage('已保存。Key 只存在服务端，本页不会再显示明文。');
      await reload();
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true); setError(''); setMessage('');
    try {
      await clearProviderKey(provider);
      setMessage('已清除该 provider 的 Key。');
      await reload();
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true); setError(''); setMessage('');
    try {
      const out = await testProviderConnection(provider);
      if (out.ok) setMessage(`连接正常，模型 ${current?.model ?? ''}，耗时 ${out.latencyMs ?? 0} ms`);
      else setError(out.error ?? (out.errors ?? ['连接失败']).join('；'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal" role="dialog" aria-modal="true">
      <div className="modal-box">
        <div className="row gap">
          <h2>设置 · 模型凭据</h2>
          <button className="ghost" onClick={onClose}>关闭</button>
        </div>
        <p className="muted">
          Key 只在服务端保存（`data/providers.json`），浏览器不会拿到明文；保存后立即生效，不用重启。
          优先使用这里保存的 Key，没有才用环境变量。
        </p>

        <div className="row wrap gap">
          <label>Provider
            <select value={provider} onChange={(e) => { setProvider(e.target.value as ProviderName); setApiKey(''); setMessage(''); setError(''); }}>
              {NAMES.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <span className={`badge ${current?.configured ? 'ok' : ''}`}>
            {current?.configured ? `已配置 ${current.maskedKey}` : '未配置'}
          </span>
          {current?.source !== 'none' && <span className="badge">来源：{current?.source === 'settings' ? '设置页' : '环境变量'}</span>}
        </div>

        <div className="row wrap gap">
          <label className="grow">API Key
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={current?.configured ? '留空 = 不修改，填写 = 覆盖' : 'sk-...'}
              autoComplete="off"
            />
          </label>
        </div>
        <div className="row wrap gap">
          <label className="grow">模型
            <input value={model} onChange={(e) => setModel(e.target.value)} />
          </label>
          <label className="grow">Base URL
            <input value={baseURL} onChange={(e) => setBaseURL(e.target.value)} />
          </label>
        </div>

        {message && <div className="banner ok-banner">{message}</div>}
        {error && <div className="banner">{error}</div>}

        <div className="row gap">
          <button disabled={busy || (!apiKey && !current?.configured)} onClick={save}>{busy ? '处理中…' : '保存'}</button>
          <button className="ghost" disabled={busy || !current?.configured} onClick={test}>测试连接</button>
          <button className="ghost danger" disabled={busy || !current?.configured} onClick={remove}>清除</button>
        </div>
      </div>
    </div>
  );
}
