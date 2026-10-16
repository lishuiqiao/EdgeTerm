import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../platform", () => ({ IS_MAC: true, IS_WINDOWS: false }));
vi.mock("./FileIcon", () => ({ FileIcon: () => null }));
vi.mock("../api", () => ({
  LOCAL_DRIVES_ROOT: "drives:",
  localHome: vi.fn().mockResolvedValue("/local"), sftpHome: vi.fn().mockResolvedValue("/remote"),
  localList: vi.fn(), sftpList: vi.fn(),
  localParent: vi.fn().mockResolvedValue("/"),
  localRename: vi.fn(), sftpRename: vi.fn(), localRemove: vi.fn(), sftpRemove: vi.fn(),
  localMkdir: vi.fn(), sftpMkdir: vi.fn(), sftpDownload: vi.fn(), sftpUpload: vi.fn(),
}));
import * as api from "../api";
import { useStore } from "../store";
import { FtpPane } from "./FtpPane";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const initial = useStore.getState();
let root: Root;
let container: HTMLDivElement;
const listing = (path: string) => ({ path, entries: [{ name: "file.txt", path: `${path}/file.txt`, isDir: false, isSymlink: false, size: 10, modified: null, permissions: null, owner: null, group: null }] });
beforeEach(async () => {
  vi.clearAllMocks();
  vi.mocked(api.localList).mockImplementation(async (path) => listing(path));
  vi.mocked(api.sftpList).mockImplementation(async (_id, path) => listing(path));
  vi.spyOn(window, "prompt").mockReturnValue("new.txt");
  vi.spyOn(window, "confirm").mockReturnValue(false);
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
  useStore.setState(initial, true);
  useStore.getState().addTab({ id: "ftp", name: "FTP", profileId: null, kind: "ftp", protocol: "ftp", address: "server", color: null, supportsRemoteFiles: true, recording: null, legacyAlgorithms: [], sharedConnection: false }, { id: "p", name: "FTP", kind: "ftp" });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(createElement(FtpPane, { tab: useStore.getState().tabs[0], active: true })));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView"); useStore.setState(initial, true); });
const list = (side = 0) => container.querySelectorAll<HTMLDivElement>(".ftp-browser-list")[side];
async function key(key: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  await act(async () => document.activeElement!.dispatchEvent(event)); return event;
}
describe("FTP browser WindTerm shortcuts", () => {
  it("navigates both panes and renames through their existing actions", async () => {
    list().focus(); await key("ArrowDown"); await key("F2");
    expect(api.sftpRename).toHaveBeenCalledWith("ftp", "/remote/file.txt", "/remote/new.txt");
    list(1).focus(); await key("Home"); await key("F2");
    expect(api.localRename).toHaveBeenCalledWith("/local/file.txt", "/local/new.txt");
    await key("n", { metaKey: true, shiftKey: true });
    expect(api.localMkdir).toHaveBeenCalledWith("/local/new.txt");
  });
  it("keeps Delete confirmation, ignores repeats/IME and preserves address editing", async () => {
    list().focus(); await key("ArrowDown");
    await key("Delete", { repeat: true }); await key("Delete", { isComposing: true });
    expect(window.confirm).not.toHaveBeenCalled();
    await key("Delete"); expect(window.confirm).toHaveBeenCalled(); expect(api.sftpRemove).not.toHaveBeenCalled();
    await key("∂", { code: "KeyD", altKey: true });
    expect(document.activeElement?.tagName).toBe("INPUT");
    expect((await key("Delete")).defaultPrevented).toBe(false);
  });
  it("refreshes and uses F3/F4 for the existing transfer actions", async () => {
    list().focus(); await key("F5"); expect(api.sftpList).toHaveBeenCalledTimes(2);
    await key("ArrowDown");
    vi.mocked(window.confirm).mockReturnValue(true);
    await key("F3"); expect(api.sftpDownload).toHaveBeenCalledWith("ftp", "/remote/file.txt", "/local/file.txt", expect.any(Function));
    list(1).focus(); await key("ArrowDown");
    await key("F4"); expect(api.sftpUpload).toHaveBeenCalledWith("ftp", "/local/file.txt", "/remote/file.txt", expect.any(Function));
  });
});
