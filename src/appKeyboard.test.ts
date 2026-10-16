import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./platform", () => ({ IS_MAC: true, IS_WINDOWS: false }));
import { appKeyboardBlocked, closedSessionShortcut, installAppKeyboard, installBrowserReloadGuard } from "./appKeyboard";
import { defaultShortcuts, setActiveShortcuts } from "./shortcuts";
import { installSearchShortcuts } from "./searchShortcuts";

const cleanup: (() => void)[] = [];
afterEach(() => {
  cleanup.splice(0).forEach((fn) => fn());
  document.body.replaceChildren();
  setActiveShortcuts(defaultShortcuts());
  vi.useRealTimers();
});
const press = (code: string, mods: KeyboardEventInit = {}, target: HTMLElement = document.body) => {
  const key = /^Key/.test(code) ? code.slice(3).toLowerCase() : code;
  const event = new KeyboardEvent("keydown", { key, code, bubbles: true, cancelable: true, ...mods });
  target.dispatchEvent(event);
  return event;
};

describe("application keyboard ownership", () => {
  it("blocks WebView reload after panel F5 handling, and allows a rebound app action", () => {
    cleanup.push(installBrowserReloadGuard());
    const panel = document.createElement("div"); document.body.append(panel);
    const handler = vi.fn((event: KeyboardEvent) => {
      expect(event.defaultPrevented).toBe(false);
      event.preventDefault(); event.stopPropagation();
    });
    panel.addEventListener("keydown", handler);
    press("F5", {}, panel);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(press("F5").defaultPrevented).toBe(true);
    expect(press("KeyR", { metaKey: true }).defaultPrevented).toBe(true);
    setActiveShortcuts({ ...defaultShortcuts(), newSession: { code: "F5", alt: false, ctrl: false, meta: false, shift: false } });
    const dispatch = vi.fn((_action, event: KeyboardEvent) => event.preventDefault());
    cleanup.push(installAppKeyboard(dispatch));
    expect(press("F5").defaultPrevented).toBe(true);
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({ kind: "newSession" }, expect.any(KeyboardEvent));
  });
  it("does not act behind dialogs, in editors, during IME, or after consumption", () => {
    const dispatch = vi.fn(); cleanup.push(installAppKeyboard(dispatch));
    const dialog = document.createElement("div"); dialog.className = "dialog-backdrop";
    const button = document.createElement("button"); dialog.append(button); document.body.append(dialog);
    press("KeyW", { metaKey: true }, button);
    dialog.remove();
    const input = document.createElement("input"); document.body.append(input);
    press("KeyW", { metaKey: true }, input);
    press("KeyW", { metaKey: true, isComposing: true });
    const cancel = (event: KeyboardEvent) => event.preventDefault();
    input.addEventListener("keydown", cancel);
    expect(appKeyboardBlocked(press("KeyW", { metaKey: true }, input))).toBe(true);
    expect(dispatch).not.toHaveBeenCalled();
    press("KeyW", { metaKey: true });
    expect(dispatch).toHaveBeenCalledWith({ kind: "closeSession" }, expect.any(KeyboardEvent));
  });

  it("accepts two-stroke window commands with modifiers released between strokes", () => {
    const dispatch = vi.fn(); cleanup.push(installAppKeyboard(dispatch));
    expect(press("KeyW", { altKey: true }).defaultPrevented).toBe(true);
    press("AltLeft", { altKey: true, key: "Alt" });
    expect(press("KeyF", { altKey: true }).defaultPrevented).toBe(true);
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({ kind: "togglePanel", panel: "filer" }, expect.any(KeyboardEvent));
    press("KeyW", { altKey: true }); press("KeyH", { altKey: true });
    expect(dispatch).toHaveBeenLastCalledWith({ kind: "splitPane", side: "down" }, expect.any(KeyboardEvent));
    press("KeyT", { altKey: true }); press("KeyN", { altKey: true });
    expect(dispatch).toHaveBeenLastCalledWith({ kind: "toggleGutter", field: "line" }, expect.any(KeyboardEvent));
  });

  it("cancels prefixes on timeout, focus change, blur and Escape", () => {
    vi.useFakeTimers();
    const dispatch = vi.fn(); cleanup.push(installAppKeyboard(dispatch));
    press("KeyW", { altKey: true }); vi.advanceTimersByTime(1501); press("KeyF", { altKey: true });
    press("KeyW", { altKey: true }); window.dispatchEvent(new Event("blur")); press("KeyF", { altKey: true });
    press("KeyW", { altKey: true }); press("Escape"); press("KeyF", { altKey: true });
    const button = document.createElement("button"); document.body.append(button);
    press("KeyW", { altKey: true }); button.focus(); press("KeyF", { altKey: true }, button);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("honors explicit bindings and retires a sequence when its action is rebound", () => {
    const dispatch = vi.fn(); cleanup.push(installAppKeyboard(dispatch));
    setActiveShortcuts({ ...defaultShortcuts(), panelFiler: null });
    press("KeyW", { altKey: true }); press("KeyF", { altKey: true });
    expect(dispatch).not.toHaveBeenCalled();
    setActiveShortcuts({ ...defaultShortcuts(), newSession: { code: "KeyW", alt: true, ctrl: false, shift: false, meta: false } });
    press("KeyW", { altKey: true });
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({ kind: "newSession" }, expect.any(KeyboardEvent));
  });

  it("routes previous-search to hovered Filer or the terminal without double dispatch", () => {
    const filer = vi.fn(() => true), terminal = vi.fn(), dispatch = vi.fn();
    cleanup.push(installSearchShortcuts(filer, terminal), installAppKeyboard(dispatch));
    press("F3", { altKey: true, shiftKey: true });
    expect(filer).toHaveBeenLastCalledWith("previous");
    expect(terminal).not.toHaveBeenCalled(); expect(dispatch).not.toHaveBeenCalled();
    filer.mockReturnValue(false);
    press("KeyG", { metaKey: true, shiftKey: true });
    expect(terminal).toHaveBeenLastCalledWith("previous");
  });

  it("only reconnects Enter and closes Ctrl+D after the session has ended", () => {
    const enter = new KeyboardEvent("keydown", { key: "Enter", code: "Enter" });
    const eof = new KeyboardEvent("keydown", { key: "d", code: "KeyD", ctrlKey: true });
    expect(closedSessionShortcut(enter, "connected")).toBeNull();
    expect(closedSessionShortcut(eof, "connecting")).toBeNull();
    expect(closedSessionShortcut(enter, "closed")).toBe("reconnect");
    expect(closedSessionShortcut(eof, "error")).toBe("close");
  });
});
