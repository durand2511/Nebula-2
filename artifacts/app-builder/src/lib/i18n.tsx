/**
 * Featherweight i18n: the app is written in Dutch; every translated spot calls `t(nl, en)` with
 * both texts inline. No keys, no dictionaries — adding a translation is a one-line change at the
 * string itself. The chosen language persists in localStorage and is picked on the startup splash.
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

export type Lang = "nl" | "en";
const KEY = "nebula_lang";

export function storedLang(): Lang {
  try { return localStorage.getItem(KEY) === "en" ? "en" : "nl"; } catch { return "nl"; }
}

type Ctx = { lang: Lang; setLang: (l: Lang) => void; t: (nl: string, en: string) => string };
const LangCtx = createContext<Ctx>({ lang: "nl", setLang: () => {}, t: (nl) => nl });

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(storedLang);
  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try { localStorage.setItem(KEY, l); } catch { /* private mode */ }
  }, []);
  const t = useCallback((nl: string, en: string) => (lang === "en" ? en : nl), [lang]);
  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <LangCtx.Provider value={value}>{children}</LangCtx.Provider>;
}

export function useLang(): Ctx {
  return useContext(LangCtx);
}
