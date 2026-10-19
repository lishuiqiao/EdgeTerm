import { describe, expect, it, vi } from "vitest";
vi.mock("./platform", () => ({ IS_MAC: true, IS_WINDOWS: false }));
import { ManualAiSuggestion } from "./aiSuggestion";
import { useStore } from "./store";
import { defaultShortcuts, matchAppShortcut, setActiveShortcuts } from "./shortcuts";

describe("manual AI suggestions", () => {
  it("never requests on editing and discards late results even if text is restored", async () => {
    let reply!: (command: string) => void;
    const request = vi.fn(() => new Promise<string>(resolve => { reply = resolve; }));
    const changed = vi.fn(), error = vi.fn();
    const ai = new ManualAiSuggestion(changed, error, request);
    const pending = ai.generate("list files", "bash");
    ai.clear(); reply("ls -al"); await pending;
    expect(ai.value).toBeNull(); expect(request).toHaveBeenCalledTimes(1);
    expect(ai.take("list files")).toBeNull(); expect(error).not.toHaveBeenCalled();
  });
  it("accepts only the current completed request, once, without execution bytes", async () => {
    const request = vi.fn().mockResolvedValue("find . -type f");
    const ai = new ManualAiSuggestion(vi.fn(), vi.fn(), request);
    await ai.generate("find files", "bash");
    expect(ai.take("changed")).toBeNull();
    await ai.generate("find files", "bash");
    expect(ai.take("find files")).toBe("find . -type f");
    expect(ai.take("find files")).toBeNull();
  });
  it("does not double-submit while pending or show stale errors", async () => {
    let reject!: (e: Error) => void;
    const request = vi.fn(() => new Promise<string>((_, r) => { reject = r; }));
    const error = vi.fn(), ai = new ManualAiSuggestion(vi.fn(), error, request);
    const pending = ai.generate("hello", "sh");
    await ai.generate("hello", "sh");
    ai.clear(); reject(new Error("timeout")); await pending;
    expect(request).toHaveBeenCalledTimes(1); expect(error).not.toHaveBeenCalled();
  });
  it("rejects implicit execution and ANSI sequences", async () => {
    const error = vi.fn(), ai = new ManualAiSuggestion(vi.fn(), error, vi.fn().mockResolvedValue("ls\nwhoami"));
    await ai.generate("files", "bash");
    expect(ai.value).toBeNull(); expect(error).toHaveBeenCalledOnce();
  });
  it("keeps switches mutually exclusive including imported conflicting preferences", () => {
    const initial = useStore.getState();
    try {
      initial.setAiSuggestionsEnabled(true);
      expect(useStore.getState().suggestionsEnabled).toBe(false);
      initial.setSuggestionsEnabled(true);
      expect(useStore.getState().aiSuggestionsEnabled).toBe(false);
      initial.applySettings({ suggestionsEnabled: true, aiSuggestionsEnabled: true });
      expect(useStore.getState().aiSuggestionsEnabled).toBe(true);
      expect(useStore.getState().suggestionsEnabled).toBe(false);
      initial.resetSettings(); expect(useStore.getState().aiSuggestionsEnabled).toBe(false);
    } finally { useStore.setState(initial, true); }
  });
  it("supports rebinding generation without retaining the default key", () => {
    const defaults = defaultShortcuts();
    const event = { key: "G", code: "KeyG", ctrlKey: false, shiftKey: true, metaKey: true, altKey: false };
    try {
      setActiveShortcuts(defaults); expect(matchAppShortcut(event)?.kind).toBe("aiSuggest");
      setActiveShortcuts({ ...defaults, aiSuggest: { ctrl: false, shift: false, meta: false, alt: false, code: "F9" } });
      expect(matchAppShortcut(event)?.kind).toBe("findPrevious");
      expect(matchAppShortcut({ ...event, metaKey: false, ctrlKey: false, shiftKey: false, key: "F9", code: "F9" })?.kind).toBe("aiSuggest");
    } finally { setActiveShortcuts(defaults); }
  });
});
