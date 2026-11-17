/** 离线词典：/data/dictionary.json，1.1 万词条 + 1.4 万词形。 */
export interface DictEntry {
  head: string;
  phon: string;
  trans: string;
}

interface DictFile {
  words: Record<string, [string, string]>;
  forms: Record<string, string>;
}

let cache: DictFile | null = null;
let loading: Promise<DictFile> | null = null;

export function loadDictionary(): Promise<DictFile> {
  if (cache) return Promise.resolve(cache);
  if (!loading) {
    loading = fetch('/data/dictionary.json')
      .then((r) => {
        if (!r.ok) throw new Error(`词典加载失败：${r.status}`);
        return r.json() as Promise<DictFile>;
      })
      .then((data) => {
        cache = data;
        return data;
      });
  }
  return loading;
}

export function cleanWord(raw: string): string {
  return String(raw || '').toLowerCase().replace(/^[^a-z]+/, '').replace(/[^a-z']+$/, '');
}

function candidates(w: string): string[] {
  const out = [w];
  if (w.endsWith("'s")) out.push(w.slice(0, -2));
  if (w.endsWith("'")) out.push(w.slice(0, -1));
  const b = out[out.length - 1];
  if (b.endsWith('ies')) out.push(`${b.slice(0, -3)}y`);
  if (b.endsWith('es')) out.push(b.slice(0, -2));
  if (b.endsWith('s')) out.push(b.slice(0, -1));
  if (b.endsWith('ed')) out.push(b.slice(0, -2), b.slice(0, -1));
  if (b.endsWith('ing')) out.push(b.slice(0, -3), `${b.slice(0, -3)}e`);
  if (b.endsWith('ly')) out.push(b.slice(0, -2));
  const dbl = b.match(/(.)\1(ed|ing)$/);
  if (dbl) out.push(b.slice(0, -(dbl[2].length + 2)) + dbl[1]);
  return out.filter((x, i) => x && x.length > 1 && out.indexOf(x) === i);
}

export function lookupIn(dict: DictFile, raw: string): DictEntry | null {
  if (!dict?.words) return null;
  for (const c of candidates(cleanWord(raw))) {
    if (dict.words[c]) return { head: c, phon: dict.words[c][0] || '', trans: dict.words[c][1] || '' };
    const lemma = dict.forms?.[c];
    if (lemma && dict.words[lemma]) {
      return { head: lemma, phon: dict.words[lemma][0] || '', trans: dict.words[lemma][1] || '' };
    }
    if (dict.words[`${c}e`]) return { head: `${c}e`, phon: dict.words[`${c}e`][0] || '', trans: dict.words[`${c}e`][1] || '' };
  }
  return null;
}

export async function lookup(raw: string): Promise<DictEntry | null> {
  const dict = await loadDictionary();
  return lookupIn(dict, raw);
}
