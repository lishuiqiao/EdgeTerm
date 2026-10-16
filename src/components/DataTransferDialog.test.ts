import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../platform", () => ({ IS_MAC: true, IS_WINDOWS: false }));
vi.mock("../api", () => ({
  previewAppData: vi.fn(),
  exportAppData: vi.fn(),
  importAppDataFile: vi.fn(),
}));
vi.mock("../nativeDialog", () => ({ save: vi.fn(), open: vi.fn() }));

import * as api from "../api";
import * as nativeDialog from "../nativeDialog";
import { useStore } from "../store";
import type { BackupPreview } from "../types";
import { DataTransferDialog, type DataTransferRequest } from "./DataTransferDialog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const initialState = useStore.getState();
const close = vi.fn();
const loadProfiles = vi.fn().mockResolvedValue(undefined);
const summary = { profiles: 1, groups: 0, senderCommands: 0, skippedSenderCommands: 0 };
const unlocked: BackupPreview = {
  encrypted: true, fingerprint: "file-fingerprint", data: {
    app: "EdgeTerm", format: 3, profiles: [{ id: "session", name: "server", kind: "ssh" }],
    groups: [], senderCommands: [], settings: { theme: "light" },
  },
};
let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.resetAllMocks();
  loadProfiles.mockResolvedValue(undefined);
  useStore.setState({ ...initialState, loadProfiles }, true);
  vi.mocked(api.exportAppData).mockResolvedValue(summary);
  vi.mocked(nativeDialog.save).mockResolvedValue("/tmp/backup");
  vi.mocked(api.previewAppData).mockResolvedValue({ encrypted: true, fingerprint: "file-fingerprint", data: null });
  vi.mocked(api.importAppDataFile).mockResolvedValue({ summary, settings: { theme: "light" } });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  useStore.setState(initialState, true);
});

const field = (name: string) => document.querySelector<HTMLInputElement>(`input[aria-label="${name}"]`)!;
const button = (name: string) => Array.from(document.querySelectorAll("button")).find((item) => item.textContent === name)!;
const error = () => document.querySelector('[role="alert"]')?.textContent;
async function render(request: DataTransferRequest = { mode: "export" }) {
  await act(async () => root.render(createElement(DataTransferDialog, { request, onClose: close })));
}
async function click(name: string) { await act(async () => button(name).click()); }
async function toggle() { await act(async () => document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click()); }
async function fill(name: string, value: string) {
  await act(async () => {
    const input = field(name);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("encrypted configuration transfer", () => {
  it("defaults to exporting without credentials and appends the data extension", async () => {
    await render();
    expect(document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(false);
    expect(field("Export password")).toBeNull();
    await click("Export…");
    expect(api.exportAppData).toHaveBeenCalledWith("/tmp/backup.edgeterm", expect.any(Object), expect.any(String), null);
    expect(close).toHaveBeenCalledOnce();
  });

  it("requires matching passwords before encrypted export and never persists the export password", async () => {
    await render();
    await toggle();
    expect(field("Export password").type).toBe("password");
    await fill("Export password", "short");
    await click("Export…");
    expect(error()).toContain("at least 8");
    expect(nativeDialog.save).not.toHaveBeenCalled();
    await fill("Export password", "portable secret");
    await fill("Confirm password", "different secret");
    await click("Export…");
    expect(error()).toContain("do not match");
    await fill("Confirm password", "portable secret");
    await click("Export…");
    expect(api.exportAppData).toHaveBeenCalledWith("/tmp/backup.edgeterm", expect.any(Object), expect.any(String), "portable secret");
    expect(JSON.stringify(useStore.getState())).not.toContain("portable secret");
    expect(close).toHaveBeenCalledOnce();
  });

  it("clears passwords when opting out and does not close or export on save cancellation", async () => {
    await render();
    await toggle();
    await fill("Export password", "portable secret");
    await toggle();
    await toggle();
    expect(field("Export password").value).toBe("");
    await toggle();
    vi.mocked(nativeDialog.save).mockResolvedValue(null);
    await click("Export…");
    expect(api.exportAppData).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    await click("Cancel");
    expect(close).toHaveBeenCalledOnce();
  });

  it("retries a wrong password and imports only after confirming the unlocked preview", async () => {
    await render({ mode: "import", path: "/tmp/backup.edgeterm" });
    expect(button("Unlock").disabled).toBe(true);
    await fill("Export password", "wrong password");
    vi.mocked(api.previewAppData).mockRejectedValueOnce("Incorrect export password or damaged backup file");
    await click("Unlock");
    expect(error()).toContain("Incorrect export password");
    expect(api.importAppDataFile).not.toHaveBeenCalled();
    await fill("Export password", "portable secret");
    vi.mocked(api.previewAppData).mockResolvedValueOnce(unlocked);
    await click("Unlock");
    expect(document.body.textContent).toContain("1 session");
    expect(field("Export password")).toBeNull();
    expect(api.importAppDataFile).not.toHaveBeenCalled();
    await click("Import");
    expect(api.importAppDataFile).toHaveBeenCalledWith("/tmp/backup.edgeterm", "file-fingerprint", "portable secret");
    expect(useStore.getState().theme).toBe("light");
    expect(loadProfiles).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it("can cancel an unlocked preview without importing or changing settings", async () => {
    await render({ mode: "import", path: "/tmp/backup.edgeterm" });
    await fill("Export password", "portable secret");
    vi.mocked(api.previewAppData).mockResolvedValueOnce(unlocked);
    await click("Unlock");
    await click("Cancel");
    expect(api.importAppDataFile).not.toHaveBeenCalled();
    expect(useStore.getState().theme).toBe(initialState.theme);
  });

  it("imports old plain files without requesting a password", async () => {
    vi.mocked(api.previewAppData).mockResolvedValue({ ...unlocked, encrypted: false });
    await render({ mode: "import", path: "/tmp/old.edgeterm" });
    expect(field("Export password")).toBeNull();
    await click("Import");
    expect(api.importAppDataFile).toHaveBeenCalledWith("/tmp/old.edgeterm", "file-fingerprint", null);
  });

  it("does not apply settings after an import failure", async () => {
    vi.mocked(api.previewAppData).mockResolvedValue({ ...unlocked, encrypted: false });
    await render({ mode: "import", path: "/tmp/old.edgeterm" });
    vi.mocked(api.importAppDataFile).mockRejectedValueOnce("Backup file changed after preview");
    await click("Import");
    expect(error()).toContain("changed after preview");
    expect(useStore.getState().theme).toBe(initialState.theme);
    expect(close).not.toHaveBeenCalled();
  });
});
