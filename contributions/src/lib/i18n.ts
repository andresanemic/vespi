"use client";
import { useSyncExternalStore } from "react";

// El idioma del sitio. Mismo patron que el tema: un store externo que se lee con
// `useSyncExternalStore`, persistido en localStorage, y resuelto por un script inline en
// el `<head>` antes del primer pintado. Asi no hay parpadeo de idioma ni de tema.
//
// Cada componente trae su propio diccionario en vez de compartir uno gigante: mantiene
// el copy junto al markup que lo usa, y evita que un archivo central se vuelva el cuello
// de botella de cada cambio.
export type Lang = "en" | "es";
export const LANGS: Lang[] = ["en", "es"];
export const LANG_LABEL: Record<Lang, string> = { en: "EN", es: "ES" };

const KEY = "vespi-lang";
const EVENT = "vespi-lang-change";
let fallback: Lang = "en";

function subscribe(callback: () => void) {
  window.addEventListener(EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

function snapshot(): Lang {
  try {
    const saved = localStorage.getItem(KEY);
    return saved === "es" || saved === "en" ? saved : /^es\b/i.test(navigator.languages?.[0] || navigator.language) ? "es" : "en";
  } catch {
    return fallback;
  }
}

export function useLang(): Lang {
  return useSyncExternalStore(subscribe, snapshot, () => "en");
}

export function setLang(next: Lang) {
  fallback = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {}
  document.documentElement.lang = next;
  window.dispatchEvent(new Event(EVENT));
}
