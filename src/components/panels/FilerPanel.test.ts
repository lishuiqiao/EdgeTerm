import { act, createElement, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../platform", () => ({ IS_MAC: true, IS_WINDOWS: false }));
vi.mock("../../actions", () => ({ revealCwdInFiler: vi.fn() }));
vi.mock("../FileIcon", () => ({ FileIcon: () => null }));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ onDragDropEvent: async () => () => {} }),
}));
vi.mock("../../api", () => ({
  LOCAL_DRIVES_ROOT: "drives:",
  localHome: vi.fn().mockResolvedValue("/files"),
  localList: vi.fn(),
  sftpHome: vi.fn().mockResolvedValue("/remote"),
  sftpList: vi.fn(),
  onRemoteEditState: async () => () => {},
}));

import * as api from "../../api";
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
