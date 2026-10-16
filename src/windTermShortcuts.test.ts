import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => { vi.resetModules(); vi.doUnmock("./platform"); });

for (const mac of [true, false]) describe(mac ? "macOS WindTerm keys" : "Windows/Linux WindTerm keys", () => {
  const load = async () => {
    vi.resetModules(); vi.doMock("./platform", () => ({ IS_MAC: mac, IS_WINDOWS: !mac }));
    return import("./shortcuts");
  };
  const event = (code: string, mods: Partial<{ ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean }> = {}) =>
    ({ key: code.startsWith("Key") ? code.slice(3).toLowerCase() : code, code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods });

  it("supports the remote-mode clipboard, search, zoom and scrolling keys", async () => {
    const { matchAppShortcut: match } = await load();
    for (const [code, kind] of [["KeyC", "copy"], ["KeyV", "paste"], ["KeyA", "selectAll"], ["KeyW", "closeSession"], ["KeyL", "clear"], ["KeyX", "pasteSelection"], ["KeyD", "duplicateSession"]]) {
      expect(match(event(code, { ctrlKey: true, shiftKey: true }))?.kind).toBe(kind);
    }
    expect(match(event("Insert", { ctrlKey: true }))?.kind).toBe("copy");
    expect(match(event("Insert", { shiftKey: true }))?.kind).toBe("paste");
    expect(match(event("Delete", { shiftKey: true }))?.kind).toBe("copy");
    expect(match(event("F3", { altKey: true }))?.kind).toBe("findNext");
    expect(match(event("F3", { altKey: true, shiftKey: true }))?.kind).toBe("findPrevious");
    expect(match(event("Equal", { ctrlKey: true, shiftKey: true }))).toEqual({ kind: "zoom", step: 1 });
    expect(match(event("Home", { ctrlKey: true, shiftKey: true }))).toEqual({ kind: "scrollTerminal", direction: -1, unit: "edge" });
    expect(match(event("F3"))).toBeNull(); // A remote program still receives F3.
    expect(match(event("KeyC", { ctrlKey: true }))).toBeNull(); // SIGINT is not Copy.
  });

  it("retires all compatibility keys of an action when it is rebound or disabled", async () => {
    const s = await load();
    s.setActiveShortcuts({ ...s.defaultShortcuts(), copy: null });
    expect(s.matchAppShortcut(event("Insert", { ctrlKey: true }))).toBeNull();
    expect(s.matchAppShortcut(event("KeyC", { ctrlKey: true, shiftKey: true }))).toBeNull();
    const bindings = { ...s.defaultShortcuts(), copy: { code: "F12", ctrl: false, alt: false, shift: false, meta: false } };
    s.setActiveShortcuts(bindings);
    expect(s.matchAppShortcut(event("F12"))).toEqual({ kind: "copy" });
    expect(s.chordProblem(bindings.copy)).toBeNull();
    expect(s.matchAppShortcut(event("Delete", { shiftKey: true }))).toBeNull();
    expect(s.parseShortcuts(s.shortcutOverrides(bindings), s.defaultShortcuts())).toEqual(bindings);
  });
});
