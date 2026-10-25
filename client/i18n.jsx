import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { TE, HI } from './translations.js';

/*
 * Lightweight i18n: English text is the key. t('Hello, {name}', { name }) looks the string up in the
 * active dictionary (Telugu / Hindi) and falls back to English when a translation is missing.
 */

export const LANGUAGES = [
  { code: 'en', label: 'English', native: 'English' },
  { code: 'te', label: 'Telugu', native: 'తెలుగు' },
  { code: 'hi', label: 'Hindi', native: 'हिन्दी' },
];
const DICTS = { te: TE, hi: HI };
const KEY = 'bana.lang';

const LangCtx = createContext({ lang: 'en', setLang: () => {}, t: (s) => s });

function interpolate(s, vars) {
  return vars ? s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? `{${k}}`)) : s;
}

export function LangProvider({ children }) {
  const [lang, setLangState] = useState(() => {
    try { return localStorage.getItem(KEY) || 'en'; } catch { return 'en'; }
  });
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);
  const setLang = useCallback((l) => {
    setLangState(l);
    try { localStorage.setItem(KEY, l); } catch { /* storage unavailable */ }
  }, []);
  const t = useCallback((s, vars) => interpolate((lang !== 'en' && DICTS[lang]?.[s]) || s, vars), [lang]);
  return <LangCtx.Provider value={{ lang, setLang, t }}>{children}</LangCtx.Provider>;
}

export const useLang = () => useContext(LangCtx);
export const useT = () => useContext(LangCtx).t;
