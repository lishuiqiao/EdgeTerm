import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../../platform", () => ({ IS_MAC: true, IS_WINDOWS: false }));
vi.mock("../../api", () => ({ listSenderCommands: vi.fn().mockResolvedValue([]), suggestAiCommand: vi.fn() }));
vi.mock("../../senderSend", async (importOriginal) => ({ ...await importOriginal<typeof import("../../senderSend")>(), sendUnits: vi.fn() }));
import { suggestAiCommand } from "../../api";
import { sendUnits, type StopSignal } from "../../senderSend";
import { useStore } from "../../store";
import { SenderPanel } from "./SenderPanel";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const initial = useStore.getState();
let root: Root;
let container: HTMLDivElement;
const input = () => container.querySelector<HTMLTextAreaElement>("textarea")!;
beforeEach(async () => {
  vi.clearAllMocks();
  vi.mocked(sendUnits).mockResolvedValue({ sent: ["shell"], skipped: [] });
  useStore.setState(initial, true);
  useStore.getState().addTab({ id: "shell", name: "Shell", profileId: null, kind: "local", protocol: "shell", address: "local", color: null, supportsRemoteFiles: false, recording: null, legacyAlgorithms: [], sharedConnection: false }, { id: "", name: "Shell", kind: "local" });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(createElement(SenderPanel, { compact: false, canCompact: true, onExpandedChange: vi.fn() })));
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input(), "echo hello");
    input().dispatchEvent(new Event("input", { bubbles: true }));
  });
  input().focus();
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); useStore.setState(initial, true); });
async function key(key: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  await act(async () => input().dispatchEvent(event)); return event;
}
describe("WindTerm Sender shortcuts", () => {
  it("sends once with AltEnter and clears with AltX, including macOS Option characters", async () => {
    expect((await key("Enter", { altKey: true })).defaultPrevented).toBe(true);
    expect(sendUnits).toHaveBeenCalledTimes(1);
    await key("Enter", { altKey: true, repeat: true });
    expect(sendUnits).toHaveBeenCalledTimes(1);
    await key("≈", { altKey: true, code: "KeyX" });
    expect(input().value).toBe("");
  });
  it("stops a running send with AltQ", async () => {
    let signal: StopSignal | undefined;
    vi.mocked(sendUnits).mockImplementation(async (_ids, _units, _ending, stop) => { signal = stop; await stop.promise; return { sent: ["shell"], skipped: [] }; });
    await key("Enter", { altKey: true });
    expect(signal?.stopped).toBe(false);
    await key("œ", { code: "KeyQ", altKey: true });
    expect(signal?.stopped).toBe(true);
  });
  it("leaves ordinary input, Ctrl combinations, IME and modal dialogs alone", async () => {
    expect((await key("x")).defaultPrevented).toBe(false);
    expect((await key("x", { ctrlKey: true, altKey: true })).defaultPrevented).toBe(false);
    expect((await key("Enter", { altKey: true, isComposing: true })).defaultPrevented).toBe(false);
    const dialog = document.createElement("div"); dialog.setAttribute("aria-modal", "true"); document.body.append(dialog);
    expect((await key("x", { altKey: true })).defaultPrevented).toBe(false); dialog.remove();
    expect(input().value).toBe("echo hello"); expect(sendUnits).not.toHaveBeenCalled();
  });
});


describe("Sender AI suggestions", () => {
  it("requires a manual shortcut and replaces text with Tab without sending", async () => {
    await act(async () => useStore.getState().setAiSuggestionsEnabled(true));
    vi.mocked(suggestAiCommand).mockResolvedValue("ls -al");
    input().setSelectionRange(input().value.length, input().value.length);
    expect(suggestAiCommand).not.toHaveBeenCalled();
    await key(" ", { code: "Space", ctrlKey: true, shiftKey: true });
    expect(suggestAiCommand).toHaveBeenCalledWith("echo hello", expect.any(String));
    expect(input().value).toBe("echo hello");
    expect(container.querySelector(".ai-ghost")?.textContent).toContain("ls -al");
    expect((await key("Tab")).defaultPrevented).toBe(true);
    expect(input().value).toBe("ls -al"); expect(sendUnits).not.toHaveBeenCalled();
    expect(container.querySelector(".ai-ghost")).toBeNull();
  });
  it("drops a pending reply after input changes without requesting another one", async () => {
    await act(async () => useStore.getState().setAiSuggestionsEnabled(true));
    let reply!: (s: string) => void;
    vi.mocked(suggestAiCommand).mockImplementation(() => new Promise(r => { reply = r; }));
    input().setSelectionRange(input().value.length, input().value.length);
    await key(" ", { code: "Space", ctrlKey: true, shiftKey: true });
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input(), "new text");
      input().dispatchEvent(new Event("input", { bubbles: true }));
      reply("old command");
    });
    expect(container.querySelector(".ai-ghost")).toBeNull();
    expect(input().value).toBe("new text"); expect(suggestAiCommand).toHaveBeenCalledTimes(1);
    expect((await key("Tab")).defaultPrevented).toBe(false);
  });
  it("does not trigger while disabled or composing", async () => {
    input().setSelectionRange(input().value.length, input().value.length);
    await key(" ", { code: "Space", ctrlKey: true, shiftKey: true });
    await act(async () => useStore.getState().setAiSuggestionsEnabled(true));
    await key(" ", { code: "Space", ctrlKey: true, shiftKey: true, isComposing: true });
    expect(suggestAiCommand).not.toHaveBeenCalled();
  });
});
