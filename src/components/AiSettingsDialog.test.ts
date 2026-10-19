import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
vi.mock("../platform", () => ({ IS_MAC: true, IS_WINDOWS: false }));
vi.mock("../api", () => ({ listCommandHistory: vi.fn().mockResolvedValue([]), getAiConfig: vi.fn(), saveAiConfig: vi.fn(), testAiConfig: vi.fn() }));
import { getAiConfig, saveAiConfig, testAiConfig } from "../api";
import { useStore } from "../store";
import { AiSettingsDialog } from "./AiSettingsDialog";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const initial = useStore.getState();
let host: HTMLDivElement, root: Root;
const close = vi.fn();
beforeEach(async () => {
  vi.clearAllMocks(); useStore.setState(initial, true);
  vi.mocked(getAiConfig).mockResolvedValue({baseUrl:"https://example.com/v1",model:"test",shell:"bash",hasApiKey:true});
  vi.mocked(saveAiConfig).mockResolvedValue({baseUrl:"https://example.com/v1",model:"test",shell:"bash",hasApiKey:true});
  vi.mocked(testAiConfig).mockResolvedValue();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(createElement(AiSettingsDialog,{onClose:close})));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); useStore.setState(initial,true); });
it("loads only a redacted key and tests only on explicit request", async () => {
  expect(document.querySelector<HTMLInputElement>("input[type=password]")!.value).toBe("");
  expect(testAiConfig).not.toHaveBeenCalled(); expect(saveAiConfig).not.toHaveBeenCalled();
  await act(async () => Array.from(document.querySelectorAll("button")).find(b => b.textContent === "Test Connection")!.click());
  expect(testAiConfig).toHaveBeenCalledWith(expect.objectContaining({apiKey:null,model:"test"}));
  expect(document.body.textContent).toContain("Connection successful");
});
it("saving enabled AI disables history suggestions and invalidates existing previews", async () => {
  await act(async () => {
    useStore.getState().setSuggestionsEnabled(true);
    document.querySelector<HTMLInputElement>("input[type=checkbox]")!.click();
  });
  const before = useStore.getState().aiConfigVersion;
  await act(async () => document.querySelector("form")!.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true})));
  expect(saveAiConfig).toHaveBeenCalledWith(expect.objectContaining({apiKey:null}));
  expect(useStore.getState().aiSuggestionsEnabled).toBe(true);
  expect(useStore.getState().suggestionsEnabled).toBe(false);
  expect(useStore.getState().aiConfigVersion).toBe(before+1); expect(close).toHaveBeenCalledOnce();
});
it("saves additional rules and strict output without making a model request", async () => {
  const textarea = document.querySelector("textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, "Prefer built-in tools\nPrefer read-only commands");
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    Array.from(document.querySelectorAll("label")).find(l => l.textContent?.includes("Strict structured output"))!.querySelector("input")!.click();
  });
  await act(async () => document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(saveAiConfig).toHaveBeenCalledWith(expect.objectContaining({
    additionalRules: "Prefer built-in tools\nPrefer read-only commands", strictOutput: true
  }));
  expect(testAiConfig).not.toHaveBeenCalled();
});
