import { afterEach, expect, it, vi } from 'vitest';
vi.mock('./platform', () => ({ IS_MAC: true, IS_WINDOWS: false }));
import messages from './locales/messages.json';
import { getUiLanguage, loadUiLanguage, setUiLanguage, t } from './i18n';
import { useStore } from './store';
import { SHORTCUT_COMMANDS } from './shortcuts';
import { SESSION_SECTIONS } from './sessionGroups';
const initial = useStore.getState();
afterEach(() => { useStore.setState(initial, true); setUiLanguage('en'); localStorage.clear(); });
it('defaults to English regardless of OS language and ignores invalid saved values', () => {
  localStorage.clear(); expect(loadUiLanguage()).toBe('en');
  localStorage.setItem('edgeterm.uiLanguage', 'zh-TW'); expect(loadUiLanguage()).toBe('en');
});
it('persists language, exports/imports it, and leaves sessions and custom shortcuts untouched', () => {
  const { tabs, profiles, shortcuts } = useStore.getState();
  useStore.getState().setLanguage('zh-HK');
  expect(loadUiLanguage()).toBe('zh-HK');
  expect(document.documentElement.lang).toBe('zh-HK');
  const backup = useStore.getState().exportSettings(); expect(backup.language).toBe('zh-HK');
  useStore.getState().setLanguage('en'); useStore.getState().applySettings(backup);
  expect(getUiLanguage()).toBe('zh-HK');
  expect(useStore.getState().tabs).toBe(tabs); expect(useStore.getState().profiles).toBe(profiles);
  expect(useStore.getState().shortcuts).toEqual(shortcuts);
  useStore.getState().applySettings({ language: 'invalid' }); expect(getUiLanguage()).toBe('zh-HK');
  useStore.getState().applySettings({}); expect(getUiLanguage()).toBe('zh-HK');
  useStore.getState().resetSettings(); expect(getUiLanguage()).toBe('en');
});
it('uses Mainland and Hong Kong vocabulary and updates static command metadata live', () => {
  setUiLanguage('zh-CN');
  expect(t('Upload')).toBe('上传'); expect(t('Folder')).toBe('文件夹');
  expect(SHORTCUT_COMMANDS.find(c => c.id === 'aiSuggest')?.label).toBe('生成 AI 命令');
  setUiLanguage('zh-HK');
  expect(t('Upload')).toBe('上載'); expect(t('Folder')).toBe('資料夾');
  expect(SHORTCUT_COMMANDS.find(c => c.id === 'aiSuggest')?.label).toBe('產生 AI 指令');
  expect(SESSION_SECTIONS[0].label).toBe('SSH / Telnet 連線');
  setUiLanguage('en'); expect(t('Upload')).toBe('Upload');
});
it('inserts user text verbatim instead of translating it or treating it as a template', () => {
  setUiLanguage('zh-HK');
  expect(t('Delete {name}?', { name: 'Upload {count} <script>' })).toBe('確定刪除「Upload {count} <script>」嗎？');
  expect(t('unknown backend error')).toBe('unknown backend error');
});
it('has both Chinese translations and preserves every interpolation field', () => {
  const tokens = (s: string) => [...s.matchAll(/\{\w+\}/g)].map(m => m[0]).sort();
  for (const [key, values] of Object.entries(messages)) {
    expect(values, key).toHaveLength(2);
    for (const value of values) {
      expect(value.trim().length, key).toBeGreaterThan(0);
      expect(tokens(value), key).toEqual(tokens(key));
    }
  }
});
