import { act, createElement, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../platform", () => ({ IS_MAC: true, IS_WINDOWS: false }));
vi.mock("../../nativeDialog", () => ({ open: vi.fn(), save: vi.fn(), ask: vi.fn() }));
vi.mock("../../actions", () => ({ revealCwdInFiler: vi.fn() }));
vi.mock("../FileIcon", () => ({ FileIcon: () => null }));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ onDragDropEvent: async () => () => {} }),
}));
vi.mock("../../api", () => ({
  LOCAL_DRIVES_ROOT: "drives:",
  localHome: vi.fn().mockResolvedValue("/files"),
  localList: vi.fn(),
  localRename: vi.fn().mockResolvedValue(undefined),
  localCopyInto: vi.fn().mockResolvedValue({ files: 1, skipped: 0 }),
  sftpHome: vi.fn().mockResolvedValue("/remote"),
  sftpList: vi.fn(),
  onRemoteEditState: async () => () => {},
}));

import * as api from "../../api";
import { open as openDialog } from "../../nativeDialog";
import { useStore } from "../../store";
import type { DirListing } from "../../types";
import { installSearchShortcuts } from "../../searchShortcuts";
import { defaultShortcuts, setActiveShortcuts } from "../../shortcuts";
import { FilerPanel, type FilerPanelHandle } from "./FilerPanel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const initialState = useStore.getState();
let root: Root;
let container: HTMLDivElement;
const scrollIntoView = vi.fn();
const findInTerminal = vi.fn();
const filerRef = createRef<FilerPanelHandle>();
let removeShortcuts: () => void;

function listing(path: string, names = ["Reports", "report.LOG", "report-report.txt", "other.txt", "[记录].txt"]): DirListing {
  return {
    path,
    entries: names.map((name) => ({
      name, path: `${path}/${name}`, isDir: name === "Reports", isSymlink: false,
      size: 0, modified: null, permissions: null, owner: null, group: null,
    })),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useStore.setState(initialState, true);
  setActiveShortcuts(defaultShortcuts());
  removeShortcuts = installSearchShortcuts(
    (next) => filerRef.current?.searchIfHovered(next) ?? false,
    findInTerminal,
  );
  vi.mocked(api.localList).mockImplementation(async () => listing("/files"));
  vi.mocked(api.sftpList).mockImplementation(async () => listing("/remote"));
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true, value: scrollIntoView,
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  removeShortcuts();
  setActiveShortcuts(defaultShortcuts());
  await act(async () => root.unmount());
  container.remove();
  Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
  useStore.setState(initialState, true);
});

const button = (label: string) => container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
const input = () => container.querySelector<HTMLInputElement>('[aria-label="Search file names"]')!;
const currentName = () => container.querySelector(".is-search-current .row-label")?.textContent;
const count = () => container.querySelector(".filer-search-count")?.textContent;
const click = async (label: string) => act(async () => button(label).click());

async function query(value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input(), value);
    input().dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function key(key: string, shiftKey = false) {
  await act(async () => input().dispatchEvent(new KeyboardEvent("keydown", { key, shiftKey, bubbles: true })));
}

async function render(open = true) {
  await act(async () => root.render(createElement(FilerPanel, { ref: filerRef })));
  if (open) await click("Search files");
}

async function hover(inside: boolean) {
  await act(async () => container.querySelector(".filer-panel")!.dispatchEvent(
    new MouseEvent(inside ? "pointerover" : "pointerout", {
      bubbles: true, relatedTarget: document.body,
    }),
  ));
}

async function shortcut(key = "f", modifiers: KeyboardEventInit = { metaKey: true }) {
  const event = new KeyboardEvent("keydown", {
    key, code: `Key${key.toUpperCase()}`, bubbles: true, cancelable: true, ...modifiers,
  });
  await act(async () => (document.activeElement ?? document.body).dispatchEvent(event));
  return event;
}

describe("Filer file-name search", () => {
  it("routes Find by pointer position even when keyboard focus stays in the other area", async () => {
    await render(false);
    await shortcut();
    expect(findInTerminal).toHaveBeenLastCalledWith(false);
    await hover(true);
    expect((await shortcut()).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(input());
    await query("report");
    await shortcut("g");
    expect(count()).toBe("2/3");
    await shortcut();
    expect(input().selectionStart).toBe(0);
    expect(input().selectionEnd).toBe(6);
    // The file search still has focus after the pointer leaves the panel.
    await hover(false);
    await shortcut();
    expect(findInTerminal).toHaveBeenCalledTimes(2);
    await shortcut("g");
    expect(findInTerminal).toHaveBeenLastCalledWith(true);
    expect(count()).toBe("2/3");
  });

  it("honors remapped bindings and leaves dialog key handling alone", async () => {
    await render(false);
    await hover(true);
    setActiveShortcuts({ ...defaultShortcuts(), find: {
      code: "KeyH", ctrl: true, shift: true, meta: false, alt: false,
    } });
    expect((await shortcut()).defaultPrevented).toBe(false);
    expect(input()).toBeNull();
    await shortcut("h", { ctrlKey: true, shiftKey: true });
    expect(document.activeElement).toBe(input());
    await click("Close file search");
    const dialog = document.createElement("div");
    dialog.className = "dialog-backdrop";
    container.append(dialog);
    expect((await shortcut("h", { ctrlKey: true, shiftKey: true })).defaultPrevented).toBe(false);
    expect(input()).toBeNull();
    expect(findInTerminal).not.toHaveBeenCalled();
    dialog.remove();
  });

  it("opens before New file, focuses the input and highlights all literal matches without hiding files", async () => {
    await render();
    expect(button("Search files").nextElementSibling).toBe(button("New file"));
    expect(document.activeElement).toBe(input());
    await query("REPORT");
    expect(count()).toBe("1/3");
    expect(currentName()).toBe("Reports");
    expect(container.querySelectorAll("mark")).toHaveLength(4);
    expect(container.querySelectorAll(".filer-entry")).toHaveLength(5);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
    // Searching must not silently select a file for deletion/download.
    expect(button("Delete").disabled).toBe(true);
    await query("[记录]");
    expect(count()).toBe("1/1");
    expect(container.querySelector("mark")?.textContent).toBe("[记录]");
    await query(".");
    expect(count()).toBe("1/4");
  });

  it("cycles forward and backward, and clears highlights on Escape", async () => {
    await render();
    await query("report");
    await key("Enter");
    expect(currentName()).toBe("report.LOG");
    await click("Next file match");
    expect(count()).toBe("3/3");
    await key("Enter");
    expect(count()).toBe("1/3");
    await key("Enter", true);
    expect(count()).toBe("3/3");
    await click("Previous file match");
    expect(count()).toBe("2/3");
    await key("Escape");
    expect(input()).toBeNull();
    expect(container.querySelector("mark")).toBeNull();
    expect(document.activeElement).toBe(button("Search files"));
  });

  it("handles no results, clearing, and closing/reopening", async () => {
    await render();
    await query("missing");
    expect(count()).toBe("No results");
    expect(button("Next file match").disabled).toBe(true);
    expect(button("Previous file match").disabled).toBe(true);
    await key("Enter");
    expect(currentName()).toBeUndefined();
    await query("report");
    await query("");
    expect(count()).toBe("");
    expect(container.querySelector("mark")).toBeNull();
    await query("report");
    await click("Search files");
    await click("Search files");
    expect(input().value).toBe("");
  });

  it("updates matches after refreshing and clears the query on directory navigation", async () => {
    await render();
    await query("report");
    await key("Enter");
    vi.mocked(api.localList).mockResolvedValueOnce(listing("/files", ["Reports"]));
    await click("Refresh");
    expect(count()).toBe("1/1");
    expect(currentName()).toBe("Reports");
    vi.mocked(api.localList).mockResolvedValueOnce(listing("/files/Reports", ["inside.txt"]));
    await act(async () => container.querySelector(".filer-entry")!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    expect(input().value).toBe("");
    expect(container.querySelector("mark")).toBeNull();
  });

  it("searches SSH listings and clears stale matches when the connection closes", async () => {
    useStore.getState().addTab({
      id: "ssh-search", profileId: null, name: "server", kind: "ssh", protocol: "ssh",
      address: "host", color: null, supportsRemoteFiles: true, recording: null,
      legacyAlgorithms: [], sharedConnection: false,
    }, { id: "profile", name: "server", kind: "ssh" });
    await render();
    await query("report");
    expect(count()).toBe("1/3");
    expect(api.sftpList).toHaveBeenCalledWith("ssh-search", "/remote");
    expect(api.localList).not.toHaveBeenCalled();
    await act(async () => useStore.setState({
      tabs: useStore.getState().tabs.map((tab) => ({ ...tab, state: "closed" })),
    }));
    expect(input().value).toBe("");
    expect(container.querySelector("mark")).toBeNull();
    expect(button("Search files").disabled).toBe(true);
  });
});

describe("WindTerm Filer shortcuts", () => {
  const list = () => container.querySelector<HTMLDivElement>(".filer-list")!;
  const rows = () => container.querySelectorAll<HTMLDivElement>(".filer-entry");
  async function select(index = 1) {
    await act(async () => rows()[index].dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
    expect(document.activeElement).toBe(list());
  }
  async function press(key: string, modifiers: KeyboardEventInit = {}) {
    const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...modifiers });
    await act(async () => document.activeElement!.dispatchEvent(event));
    return event;
  }

  it("requires focus rather than hover and uses the existing delete confirmation", async () => {
    await render(false);
    await hover(true);
    expect((await press("Delete")).defaultPrevented).toBe(false);
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    await select();
    const global = vi.fn();
    window.addEventListener("keydown", global);
    expect((await press("Delete")).defaultPrevented).toBe(true);
    window.removeEventListener("keydown", global);
    expect(global).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain("report.LOG");
  });

  it("supports navigation, refresh and selecting the address bar", async () => {
    await render(false);
    list().focus();
    await press("ArrowDown");
    expect(rows()[0].classList.contains("is-active")).toBe(true);
    await press("End");
    expect(rows()[4].classList.contains("is-active")).toBe(true);
    const calls = vi.mocked(api.localList).mock.calls.length;
    expect((await press("F5")).defaultPrevented).toBe(true);
    expect(api.localList).toHaveBeenCalledTimes(calls + 1);
    await press("∂", { altKey: true, code: "KeyD" });
    const address = container.querySelector<HTMLInputElement>('[aria-label="Folder path"]')!;
    expect(document.activeElement).toBe(address);
    expect(address.selectionStart).toBe(0);
    expect(address.selectionEnd).toBe(address.value.length);
    expect((await press("Delete")).defaultPrevented).toBe(false);
  });

  it("opens file/folder creation with both Control and Command while preserving typing and IME", async () => {
    await render(false);
    list().focus();
    expect((await press("n", { ctrlKey: true, isComposing: true })).defaultPrevented).toBe(false);
    await press("n", { ctrlKey: true });
    expect(document.activeElement?.getAttribute("placeholder")).toBe("New file name");
    expect((await press("Delete")).defaultPrevented).toBe(false);
    await press("Escape");
    list().focus();
    await press("N", { metaKey: true, shiftKey: true });
    expect(document.activeElement?.getAttribute("placeholder")).toBe("New folder name");
  });

  it("renames through the existing file API and rejects collisions", async () => {
    await render(false);
    await select();
    await press("F2");
    const rename = () => container.querySelector<HTMLInputElement>('[aria-label="Rename file or folder"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(rename(), "renamed.log");
      rename().dispatchEvent(new Event("input", { bubbles: true }));
    });
    await press("Enter");
    expect(api.localRename).toHaveBeenCalledWith("/files/report.LOG", "/files/renamed.log");
    expect(document.activeElement).toBe(list());
    await select();
    await press("F2");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(rename(), "other.txt");
      rename().dispatchEvent(new Event("input", { bubbles: true }));
    });
    await press("Enter");
    expect(api.localRename).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("already exists");
  });

  it("copies local files with F3/F4 through the existing copy operation", async () => {
    await render(false);
    await select();
    vi.mocked(openDialog).mockResolvedValueOnce("/destination");
    await press("F3");
    expect(api.localCopyInto).toHaveBeenCalledWith("/files/report.LOG", "/destination", expect.any(Function));
    expect(container.querySelector<HTMLInputElement>('[aria-label="Folder path"]')?.value).toBe("/files");
    vi.mocked(openDialog).mockResolvedValueOnce(["/source/a.txt", "/source/b.txt"]);
    await press("F4");
    expect(api.localCopyInto).toHaveBeenCalledWith("/source/a.txt", "/files", expect.any(Function));
    expect(api.localCopyInto).toHaveBeenCalledWith("/source/b.txt", "/files", expect.any(Function));
    vi.mocked(openDialog).mockResolvedValueOnce(null);
    await press("F4");
    expect(api.localCopyInto).toHaveBeenCalledTimes(3);
  });

  it("returns focus to the list when deleting is cancelled", async () => {
    await render(false);
    await select();
    await press("Delete");
    await press("Escape");
    expect(document.activeElement).toBe(list());
  });

  it("opens inline rename and cancels without mutating a file", async () => {
    await render(false);
    await select();
    await press("F2");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Rename file or folder");
    expect((document.activeElement as HTMLInputElement).value).toBe("report.LOG");
    await press("Escape");
    expect(container.querySelector('[aria-label="Rename file or folder"]')).toBeNull();
    expect(document.activeElement).toBe(list());
  });
});

it("keeps multi-selection independent from search and blocks single-item shortcuts", async () => {
  await render();
  const rows = () => container.querySelectorAll<HTMLElement>(".filer-entry");
  await act(async () => rows()[1].dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 })));
  await act(async () => rows()[3].dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, metaKey: true })));
  expect(container.querySelectorAll(".filer-entry.is-active")).toHaveLength(2);
  await query("report");
  expect(container.querySelectorAll(".filer-entry.is-active")).toHaveLength(2);
  expect(container.querySelectorAll(".filer-search-match").length).toBeGreaterThan(0);
  const list = container.querySelector<HTMLDivElement>(".filer-list")!;
  list.focus();
  for (const key of ["F2", "Delete"]) {
    await act(async () => list.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })));
  }
  expect(container.querySelector('[aria-label="Rename file or folder"]')).toBeNull();
  expect(document.querySelector('[aria-modal="true"]')).toBeNull();
  await act(async () => rows()[4].dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, shiftKey: true })));
  expect(Array.from(container.querySelectorAll(".filer-entry.is-active .row-label")).map(e => e.textContent)).toEqual(["other.txt", "[记录].txt"]);
  await act(async () => list.dispatchEvent(new KeyboardEvent("keydown", { key: "F5", bubbles: true, cancelable: true })));
  expect(container.querySelectorAll(".filer-entry.is-active")).toHaveLength(0);
});
