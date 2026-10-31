import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import copy from './copy.json';
type Language = 'en'|'vi';
type Values = Record<string,string|number>;
const Context = createContext({lang:'en' as Language,setLang:(_l:Language)=>{},t:(k:string,_v?:Values)=>k});
export function I18nProvider({children}:{children:ReactNode}) {
  const [lang,setLang] = useState<Language>(()=>{try{return localStorage.getItem('weeat-v2-language')==='vi'?'vi':'en';}catch{return 'en';}});
  const t = (k:string,v:Values={}) => { const row=(copy as Record<string,{en:string;vi:string}>)[k]; return Object.entries(v).reduce((s,[key,value])=>s.replaceAll(`{${key}}`,String(value)),row?.[lang]||k); };
  useEffect(()=>{document.documentElement.lang=lang;document.title=t('documentTitle');document.querySelector('meta[name="description"]')?.setAttribute('content',t('documentDescription'));try{localStorage.setItem('weeat-v2-language',lang);}catch{/* language stays in memory */}},[lang]);
  return <Context.Provider value={{lang,setLang,t}}>{children}</Context.Provider>;
}
export const useI18n = ()=>useContext(Context);
