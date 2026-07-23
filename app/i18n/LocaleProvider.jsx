"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import zh from "./dict/zh.json";
import en from "./dict/en.json";
import ja from "./dict/ja.json";
import es from "./dict/es.json";
import pt from "./dict/pt.json";
import fr from "./dict/fr.json";

const DICTS = { zh, en, ja, es, pt, fr };
export const LOCALES = [
  { id: "zh", label: "中文" },
  { id: "en", label: "EN" },
  { id: "ja", label: "日本語" },
  { id: "es", label: "ES" },
  { id: "pt", label: "PT" },
  { id: "fr", label: "FR" },
];
const STORAGE_KEY = "animalCupLocale";

const LocaleContext = createContext({ locale: "en", setLocale: () => {}, t: (k) => k });

export function LocaleProvider({ children }) {
  // SSR-safe: render English on the server, then restore an explicit choice
  // or match the browser language after mount.
  const [locale, setLocaleState] = useState("en");

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    const browserLocale = navigator.language.toLowerCase().split("-")[0];
    const nextLocale = saved && DICTS[saved] ? saved : (DICTS[browserLocale] ? browserLocale : "en");
    setLocaleState(nextLocale);
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((id) => {
    if (!DICTS[id]) return;
    setLocaleState(id);
    try { localStorage.setItem(STORAGE_KEY, id); } catch {}
  }, []);

  const t = useCallback(
    (key, vars) => {
      let str = DICTS[locale][key] ?? DICTS.en[key] ?? key;
      if (vars) for (const [k, v] of Object.entries(vars)) str = str.replaceAll(`{${k}}`, v);
      return str;
    },
    [locale],
  );

  return (
    <LocaleContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </LocaleContext.Provider>
  );
}

export function useLocale() {
  return useContext(LocaleContext);
}
