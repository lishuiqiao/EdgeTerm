import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./platform", () => ({ IS_MAC: true, IS_WINDOWS: false }));

import { patchImeInput } from "./imePatch";
import { defaultShortcuts, matchAppShortcut, setActiveShortcuts } from "./shortcuts";
import { TerminalController } from "./terminal";

const cleanups: (() => void)[] = [];

function harness() {
  const out: string[] = [];
  const controller = new TerminalController("keyboard-test", {
    onData: (data) => out.push(data),
    onResize() {}, onStatus() {}, onCommand() {}, onCommandState() {},
    suggest: () => [], forgetSuggestion() {},
  }, 13, 100);
  const host = document.createElement("div");
  document.body.append(host);
  controller.term.open(host);
  patchImeInput(controller.term);
  cleanups.push(() => { controller.dispose(); host.remove(); });
  return {
    controller, out,
    write: (data: string) => new Promise<void>((resolve) => controller.term.write(data, resolve)),
    key(key: string, keyCode: number, modifiers: KeyboardEventInit = {}) {
      const event = new KeyboardEvent("keydown", {
        key, code: key, keyCode, bubbles: true, cancelable: true, ...modifiers,
      });
      controller.term.textarea!.dispatchEvent(event);
      return event;
    },
  };
}

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  setActiveShortcuts(defaultShortcuts());
});

describe("terminal keyboard bytes", () => {
  it("adapts macOS Fn/Home and Fn/End to the ordinary shell's line controls", () => {
    const h = harness();
    expect(h.key("Home", 36).defaultPrevented).toBe(true);
    h.key("End", 35);
    expect(h.out).toEqual(["\x01", "\x05"]);
  });

  it("lets users restore native Home/End sequences on the ordinary screen", () => {
    const h = harness();
    h.controller.setMacHomeEnd(false);
    h.key("Home", 36); h.key("End", 35);
    expect(h.out.splice(0)).toEqual(["\x1b[H", "\x1b[F"]);
    h.controller.setMacHomeEnd(true);
    h.key("Home", 36); h.key("End", 35);
    expect(h.out).toEqual(["\x01", "\x05"]);
  });

  it("preserves xterm Home/End in alternate-screen and application-cursor modes", async () => {
    const h = harness();
    await h.write("\x1b[?1049h");
    h.key("Home", 36); h.key("End", 35);
    expect(h.out.splice(0)).toEqual(["\x1b[H", "\x1b[F"]);
    await h.write("\x1b[?1h");
    h.key("Home", 36); h.key("End", 35);
    expect(h.out.splice(0)).toEqual(["\x1bOH", "\x1bOF"]);
    await h.write("\x1b[?1049l");
    h.key("Home", 36); h.key("End", 35);
    expect(h.out.splice(0)).toEqual(["\x1bOH", "\x1bOF"]);
    await h.write("\x1b[?1l");
    h.key("Home", 36); h.key("End", 35);
    expect(h.out).toEqual(["\x01", "\x05"]);
  });

  it("preserves modified Home/End and other native terminal keys", () => {
    const h = harness();
    h.key("Home", 36, { ctrlKey: true });
    h.key("End", 35, { ctrlKey: true });
    h.key("Home", 36, { altKey: true });
    h.key("End", 35, { shiftKey: true });
    h.key("ArrowLeft", 37);
    h.key("Delete", 46);
    h.key("F5", 116);
    h.key("Tab", 9, { shiftKey: true });
    h.key("r", 82, { code: "KeyR", ctrlKey: true });
    expect(h.out).toEqual([
      "\x1b[1;5H", "\x1b[1;5F", "\x1b[1;3H", "\x1b[1;2F",
      "\x1b[D", "\x1b[3~", "\x1b[15~", "\x1b[Z", "\x12",
    ]);
  });

  it("retains Option word movement when there is no application binding", () => {
    const h = harness();
    h.key("ArrowLeft", 37, { altKey: true });
    h.key("ArrowRight", 39, { altKey: true });
    expect(h.out).toEqual(["\x1bb", "\x1bf"]);
  });

  it("sends the xterm F13–F20 sequences once each", () => {
    const h = harness();
    for (let number = 13; number <= 20; number++) h.key(`F${number}`, 111 + number);
    expect(h.out).toEqual([25, 26, 28, 29, 31, 32, 33, 34].map((code) => `\x1b[${code}~`));
  });

  it("redraws through the input path without erasing local scrollback or bubbling", async () => {
    const h = harness();
    await h.write("line\r\n".repeat(40));
    const length = h.controller.term.buffer.active.length;
    const bubbled = vi.fn();
    window.addEventListener("keydown", bubbled);
    cleanups.push(() => window.removeEventListener("keydown", bubbled));
    h.key("l", 76, { code: "KeyL", metaKey: true });
    expect(h.out).toEqual(["\x0c"]);
    expect(h.controller.term.buffer.active.length).toBe(length);
    expect(bubbled).not.toHaveBeenCalled();
  });

  it("routes local line, page and edge scrolling without sending PTY bytes", () => {
    const h = harness();
    // jsdom has no viewport geometry; spy on the real xterm scrolling entry
    // points while exercising actual textarea events and the onData stream.
    const lines = vi.spyOn(h.controller.term, "scrollLines");
    const pages = vi.spyOn(h.controller.term, "scrollPages");
    const top = vi.spyOn(h.controller.term, "scrollToTop");
    const bottom = vi.spyOn(h.controller.term, "scrollToBottom");
    const modifiers = { ctrlKey: true, shiftKey: true };
    h.key("ArrowUp", 38, modifiers);
    expect(lines).toHaveBeenLastCalledWith(-1);
    h.key("ArrowDown", 40, modifiers);
    expect(lines).toHaveBeenLastCalledWith(1);
    h.key("PageUp", 33, modifiers);
    expect(pages).toHaveBeenLastCalledWith(-1);
    h.key("PageDown", 34, modifiers);
    expect(pages).toHaveBeenLastCalledWith(1);
    h.key("Home", 36, modifiers);
    expect(top).toHaveBeenCalledTimes(1);
    h.key("End", 35, modifiers);
    expect(bottom).toHaveBeenCalledTimes(1);
    expect(h.out).toEqual([]);
  });

  it("pastes selected text through multiline confirmation and bracketed paste", async () => {
    const h = harness();
    await h.write("first\r\nsecond");
    h.controller.term.selectLines(0, 1);
    const selected = h.controller.term.getSelection();
    const confirm = vi.fn();
    h.controller.setPasteWarning(true);
    h.controller.onConfirmPaste(confirm);
    const paste = () => h.key("X", 88, { code: "KeyX", metaKey: true, shiftKey: true });
    paste();
    expect(confirm).toHaveBeenCalledExactlyOnceWith(selected);
    expect(h.out).toEqual([]);
    await h.write("\x1b[?2004h");
    h.controller.setPasteWarning(false);
    paste();
    expect(h.out).toEqual([`\x1b[200~${selected.replace(/\r?\n/g, "\r")}\x1b[201~`]);
  });

  it.each([
    ["ArrowLeft", 37, { altKey: true }, { alt: true }],
    ["Backspace", 8, { ctrlKey: true }, { ctrl: true }],
  ] as const)("prioritizes an application binding for %s without sending shell bytes", (key, code, eventMods, chordMods) => {
    const h = harness();
    h.controller.setBackspace("controlH");
    setActiveShortcuts({ ...defaultShortcuts(), newSession: {
      code: key, ctrl: false, alt: false, meta: false, shift: false, ...chordMods,
    } });
    const actions: string[] = [];
    const listener = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      const action = matchAppShortcut(event);
      if (action) { event.preventDefault(); actions.push(action.kind); }
    };
    window.addEventListener("keydown", listener);
    cleanups.push(() => window.removeEventListener("keydown", listener));
    h.key(key, code, eventMods);
    expect(actions).toEqual(["newSession"]);
    expect(h.out).toEqual([]);
  });

  it("leaves IME-owned keys to composition rather than shortcuts or shell adaptations", () => {
    const h = harness();
    const copy = vi.spyOn(h.controller, "copySelection");
    const textarea = h.controller.term.textarea!;
    textarea.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    h.key("Home", 36, { isComposing: true });
    h.key("Home", 229, { isComposing: true });
    h.key("ArrowLeft", 229, { altKey: true, isComposing: true });
    h.key("c", 229, { code: "KeyC", metaKey: true, isComposing: true });
    expect(copy).not.toHaveBeenCalled();
    expect(h.out).toEqual([]);
  });
});
