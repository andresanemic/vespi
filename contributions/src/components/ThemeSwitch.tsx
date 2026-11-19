"use client";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import { useLang, type Lang } from "@/lib/i18n";
const eventName="vespi-theme-change";
let fallbackTheme="light";
function subscribe(callback:()=>void){window.addEventListener(eventName,callback);window.addEventListener("storage",callback);return()=>{window.removeEventListener(eventName,callback);window.removeEventListener("storage",callback);};}
function snapshot(){try{const saved=localStorage.getItem("vespi-theme");return saved==="dark"||saved==="light"?saved:matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}catch{return fallbackTheme;}}
export function useVespiTheme(){return useSyncExternalStore(subscribe,snapshot,()=>"light");}
export function setVespiTheme(next:"light"|"dark"){
 fallbackTheme=next;
 try{localStorage.setItem("vespi-theme",next);}catch{}
 document.documentElement.dataset.theme=next;
 window.dispatchEvent(new Event(eventName));
}
const COPY = {
 en: { toLight: "Switch to light theme", toDark: "Switch to dark theme", light: "Light", dark: "Dark" },
 es: { toLight: "Cambiar al tema claro", toDark: "Cambiar al tema oscuro", light: "Claro", dark: "Oscuro" },
} as const;
export default function ThemeSwitch({lang: controlledLang}:{lang?:Lang}={}){
 const theme=useVespiTheme();
 const storedLang=useLang();
 const t=COPY[controlledLang??storedLang];
 const transition=useRef<ViewTransition|null>(null);
 const version=useRef(0);
 useEffect(()=>{document.documentElement.dataset.theme=snapshot();},[theme]);
 const toggle=()=>{
  const next=theme==="dark"?"light":"dark";
  const update=()=>flushSync(()=>setVespiTheme(next));
  const generation=++version.current;
  transition.current?.skipTransition();
  if(matchMedia('(prefers-reduced-motion: reduce)').matches){delete document.documentElement.dataset.themeChanging;update();return;}
  document.documentElement.dataset.themeChanging="true";
  if(typeof document.startViewTransition==='function'){
   transition.current=document.startViewTransition(update);
   transition.current.finished.finally(()=>{if(generation===version.current){delete document.documentElement.dataset.themeChanging;transition.current=null;}});
  }else{update();window.setTimeout(()=>{if(generation===version.current)delete document.documentElement.dataset.themeChanging;},500);}
 };
 return <button className="theme-switch" aria-label={theme==="dark"?t.toLight:t.toDark} onClick={toggle}><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">{theme==="dark"?<><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/></>:<path d="M20 14a8.5 8.5 0 0 1-10-10 8.5 8.5 0 1 0 10 10Z"/>}</svg><span>{theme==="dark"?t.light:t.dark}</span></button>;
}
