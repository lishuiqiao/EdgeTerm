import messages from './locales/messages.json';

export type UiLanguage = 'en' | 'zh-CN' | 'zh-HK';
export const LANGUAGE_OPTIONS: { value: UiLanguage; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'zh-CN', label: '简体中文' },
  { value: 'zh-HK', label: '繁體中文（香港）' },
];
const STORAGE_KEY = 'edgeterm.uiLanguage';
export const isUiLanguage = (value: unknown): value is UiLanguage =>
  value === 'en' || value === 'zh-CN' || value === 'zh-HK';
export function loadUiLanguage(): UiLanguage {
  try { const value = localStorage.getItem(STORAGE_KEY); return isUiLanguage(value) ? value : 'en'; }
  catch { return 'en'; }
}
let language = loadUiLanguage();
export function setUiLanguage(value: UiLanguage) {
  language = value;
  if (typeof document !== 'undefined') document.documentElement.lang = value;
  try { localStorage.setItem(STORAGE_KEY, value); } catch { /* Session-only when storage is unavailable. */ }
}
export function getUiLanguage() { return language; }
/** Translate application-owned text only. Never pass terminal output or user data here. */
export function t(message: string, values?: Record<string, unknown>): string {
  const entry = (messages as Record<string, string[]>)[message];
  const text = language === 'en' || !entry ? message : entry[language === 'zh-CN' ? 0 : 1];
  return values ? text.replace(/\{(\w+)\}/g, (token, key) => String(values[key] ?? token)) : text;
}
