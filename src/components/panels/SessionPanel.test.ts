import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../platform", () => ({ IS_MAC: true, IS_WINDOWS: false }));
vi.mock("../../actions", () => ({ openSession: vi.fn(), toggleSessionConnection: vi.fn() }));
vi.mock("../../dataTransfer", () => ({ importSshConfig: vi.fn() }));
vi.mock("../../api", () => ({ listSenderCommands: vi.fn().mockResolvedValue([]) }));
import { openSession } from "../../actions";
import { useStore } from "../../store";
import type { SessionProfile } from "../../types";
import { SessionPanel } from "./SessionPanel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const initial = useStore.getState();
const profile: SessionProfile = { id: "server", name: "Server", kind: "ssh", host: "example.test" };
const duplicate = vi.fn().mockResolvedValue({ ...profile, id: "copy" });
const remove = vi.fn();
const edit = vi.fn();
let root: Root;
let container: HTMLDivElement;

beforeEach(async () => {
  vi.clearAllMocks();
  useStore.setState({ ...initial, profiles: [profile], groups: [], duplicateProfile: duplicate, removeProfile: remove }, true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(createElement(SessionPanel, { onEditProfile: edit, onNewSession: vi.fn() })));
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  useStore.setState(initial, true);
});
const row = () => Array.from(container.querySelectorAll<HTMLElement>(".row")).find((node) => node.querySelector(".row-label")?.textContent === "Server")!;
async function key(key: string, modifiers: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...modifiers });
  await act(async () => document.activeElement!.dispatchEvent(event));
  return event;
}

describe("WindTerm session tree shortcuts", () => {
  it("opens, edits and duplicates the focused saved session", async () => {
    row().focus();
    expect((await key("Enter")).defaultPrevented).toBe(true);
    expect(openSession).toHaveBeenCalledWith(profile);
    await key("Enter", { altKey: true });
    expect(edit).toHaveBeenCalledWith(profile);
    await key("d", { ctrlKey: true });
    await key("d", { metaKey: true });
    expect(duplicate).toHaveBeenCalledTimes(2);
    expect(edit).toHaveBeenLastCalledWith({ ...profile, id: "copy" });
  });
  it("keeps deletion behind the existing confirmation and ignores repeat", async () => {
    row().focus();
    await key("Delete", { repeat: true });
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    await key("Delete");
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
    expect(remove).not.toHaveBeenCalled();
  });
  it("restores the source row when deletion is cancelled", async () => {
    row().focus();
    await key("Delete");
    await key("Escape");
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(document.activeElement).toBe(row());
  });
  it("leaves filter input, IME and other dialogs alone", async () => {
    container.querySelector<HTMLInputElement>("input")!.focus();
    expect((await key("d", { metaKey: true })).defaultPrevented).toBe(false);
    row().focus();
    expect((await key("d", { ctrlKey: true, isComposing: true })).defaultPrevented).toBe(false);
    const dialog = document.createElement("div");
    dialog.setAttribute("aria-modal", "true");
    document.body.append(dialog);
    expect((await key("Delete")).defaultPrevented).toBe(false);
    dialog.remove();
    expect(duplicate).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });
  it("supports keyboard traversal of visible rows", async () => {
    row().focus();
    await key("Home");
    expect(document.activeElement).toBe(container.querySelector(".row"));
    await key("ArrowDown");
    expect(document.activeElement).toBe(row());
  });
});
