import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('./platform', () => ({ IS_MAC: true, IS_WINDOWS: false }));
vi.mock('./api', () => ({ defaultRecordingDir: async () => '/tmp', listSerialPorts: async () => [] }));
import { SessionDialog } from './components/SessionDialog';
import { useStore } from './store';
import { setUiLanguage } from './i18n';

const initial = useStore.getState();
const container = document.createElement('div');
document.body.appendChild(container);
const root = createRoot(container);
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(async () => {
  await act(async () => root.render(null));
  useStore.setState(initial, true);
  setUiLanguage('en');
  vi.unstubAllGlobals();
});

it('updates a mounted session dialog without losing entered connection details', async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  function Screen() {
    useStore(s => s.language);
    return createElement(SessionDialog, { initial: null, onClose: () => {} });
  }
  await act(async () => root.render(createElement(Screen)));
  expect(container.textContent).toContain('New Session');
  const host = container.querySelector<HTMLInputElement>('input[placeholder="example.com"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(host, 'test.example.com');
    host.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => useStore.getState().setLanguage('zh-CN'));
  expect(container.textContent).toContain('新建会话');
  expect(container.textContent).toContain('用户名');
  expect(container.querySelector('input[placeholder="example.com"]')).toBe(host);
  expect(host.value).toBe('test.example.com');
  await act(async () => useStore.getState().setLanguage('zh-HK'));
  expect(container.textContent).toContain('新增連線');
  expect(container.textContent).toContain('用戶名稱');
  expect(host.value).toBe('test.example.com');
});
