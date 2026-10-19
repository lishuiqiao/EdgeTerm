import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("./platform", () => ({ IS_MAC: true, IS_WINDOWS: false }));
vi.mock("./api", () => ({ suggestAiCommand: vi.fn() }));
import { suggestAiCommand } from "./api";
import { TerminalController } from "./terminal";
import { setFindCloser } from "./terminalSearch";
import { defaultShortcuts, setActiveShortcuts } from "./shortcuts";
const cleanup: (() => void)[] = [];
function harness() {
  const out: string[] = [], status: string[] = [];
  let enabled = true;
  const controller = new TerminalController("ai-test", {
    onData: s => out.push(s), onStatus: s => status.push(s), onResize() {}, onCommand() {}, onCommandState() {},
    suggest: () => [], forgetSuggestion() {}, aiContext: () => ({ enabled, shell: "bash" }),
  }, 13, 100);
  const root = document.createElement("div"); document.body.append(root); controller.attach(root);
  controller.term.textarea!.focus();
  const write = (s: string) => new Promise<void>(resolve => controller.term.write(s, resolve));
  const key = (key: string, code: string, modifiers: KeyboardEventInit = {}) => {
    const event = new KeyboardEvent("keydown", { key, code, keyCode: key === "Tab" ? 9 : key === "Escape" ? 27 : 32, bubbles: true, cancelable: true, ...modifiers });
    controller.term.textarea!.dispatchEvent(event); return event;
  };
  const generate = async () => { key("G", "KeyG", { metaKey: true, shiftKey: true }); await Promise.resolve(); await Promise.resolve(); };
  const type = async (s: string) => { controller.term.input(s, true); await write(s); out.length = 0; };
  cleanup.push(() => { controller.dispose(); root.remove(); });
  return { controller, root, out, status, write, type, key, generate, disable: () => { enabled = false; } };
}
afterEach(() => { cleanup.splice(0).forEach(f => f()); vi.clearAllMocks(); setFindCloser(null); setActiveShortcuts(defaultShortcuts()); });
describe("terminal AI input", () => {
  it("keeps a Chinese request unchanged until Tab, then replaces without executing", async () => {
    const h = harness();
    vi.mocked(suggestAiCommand).mockResolvedValue("ls -al");
    await h.write("$ "); await h.type("查看文件");
    await h.generate();
    expect(suggestAiCommand).toHaveBeenCalledWith("查看文件", "bash");
    expect(h.out).toEqual([]);
    expect(h.root.querySelector(".ai-ghost")?.textContent).toContain("ls -al");
    expect(h.key("Tab", "Tab").defaultPrevented).toBe(true);
    expect(h.out.join("")).toBe("\x7f".repeat(4) + "ls -al");
    expect(h.out.join("")).not.toMatch(/[\r\n]/);
    expect(h.root.querySelector(".ai-ghost")).toBeNull();
  });
  it("drops late replies after typing, preserves native Tab, and needs another trigger", async () => {
    const h = harness(); let reply!: (s: string) => void;
    vi.mocked(suggestAiCommand).mockImplementation(() => new Promise(r => { reply = r; }));
    await h.write("$ "); await h.type("find"); await h.generate();
    await h.type(" ."); reply("find . -type f"); await Promise.resolve(); await Promise.resolve();
    expect(h.root.querySelector(".ai-ghost")).toBeNull();
    h.key("Tab", "Tab"); expect(h.out).toEqual(["\t"]);
    expect(suggestAiCommand).toHaveBeenCalledTimes(1);
  });
  it("invalidates on cursor movement, focus loss, and disconnect", async () => {
    const h = harness(); vi.mocked(suggestAiCommand).mockResolvedValue("ls");
    await h.write("$ "); await h.type("files"); await h.generate();
    h.key("ArrowLeft", "ArrowLeft"); expect(h.root.querySelector(".ai-ghost")).toBeNull();
    await h.write("\r$ files"); await h.generate();
    h.controller.term.textarea!.blur(); expect(h.root.querySelector(".ai-ghost")).toBeNull();
    h.controller.setLocked(true); await h.generate();
    expect(h.root.querySelector(".ai-ghost")).toBeNull();
  });
  it("does not request for alternate screen, unknown prompt, IME, or disabled AI", async () => {
    const h = harness();
    await h.write("Password: "); await h.type("secret"); await h.generate();
    expect(suggestAiCommand).not.toHaveBeenCalled();
    await h.write("\x1b[?1049h"); await h.type("foo"); await h.generate();
    expect(suggestAiCommand).not.toHaveBeenCalled();
    h.key("G", "KeyG", { metaKey: true, shiftKey: true, isComposing: true });
    h.disable(); await h.generate(); expect(suggestAiCommand).not.toHaveBeenCalled();
  });
});

it("dismisses AI before closing search and does not send either Escape to the shell", async () => {
  const h = harness();
  vi.mocked(suggestAiCommand).mockResolvedValue("ls -al");
  await h.write("$ "); await h.type("files"); await h.generate();
  expect(h.root.querySelector(".ai-ghost")).not.toBeNull();
  const close = vi.fn();
  setFindCloser(close);
  h.key("Escape", "Escape");
  expect(h.root.querySelector(".ai-ghost")).toBeNull();
  expect(close).not.toHaveBeenCalled();
  h.key("Escape", "Escape");
  expect(close).toHaveBeenCalledTimes(1);
  expect(h.out).toEqual([]);
});

it("keeps a long preview inside the terminal and scrollable without losing Tab acceptance", async () => {
  const h = harness();
  const command = "printf '%s' " + "long-command-".repeat(150);
  vi.mocked(suggestAiCommand).mockResolvedValue(command);
  const screen = h.root.querySelector<HTMLElement>(".xterm-screen")!;
  vi.spyOn(screen, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 300, height: 100 } as DOMRect);
  const size = vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(function(this: HTMLElement) {
    return this.classList.contains("terminal-ai-ghost") ? 500 : 0;
  });
  await h.write("$ "); await h.type("files"); await h.generate();
  const preview = h.root.querySelector<HTMLElement>(".terminal-ai-ghost")!;
  expect(preview.classList.contains("ai-preview-scroll")).toBe(true);
  expect(parseFloat(preview.style.maxHeight)).toBeLessThanOrEqual(100);
  expect(preview.textContent).toContain(command);
  preview.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  preview.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: 100 }));
  expect(h.root.querySelector(".terminal-ai-ghost")).toBe(preview);
  expect(document.activeElement).toBe(h.controller.term.textarea);
  h.key("Tab", "Tab");
  expect(h.out.join("")).toBe("\x7f".repeat(5) + command);
  size.mockRestore();
});
