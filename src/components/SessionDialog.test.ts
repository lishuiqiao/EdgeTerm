import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../platform", () => ({ IS_MAC: true, IS_WINDOWS: false }));
vi.mock("../actions", () => ({ openSession: vi.fn().mockResolvedValue("session") }));
vi.mock("../api", () => ({
  defaultRecordingDir: vi.fn().mockResolvedValue("/tmp/recordings"),
  listSerialPorts: vi.fn().mockResolvedValue([]),
}));

import { openSession } from "../actions";
import { useStore } from "../store";
import type { SessionKind, SessionProfile } from "../types";
import { SessionDialog } from "./SessionDialog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;
const initialState = useStore.getState();
const save = vi.fn(async (profile: SessionProfile) => ({ ...profile, id: "saved" }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    disconnect() {}
  });
  useStore.setState({ ...initialState, profiles: [], groups: [], upsertProfile: save }, true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  useStore.setState(initialState, true);
});

async function render(kind: SessionKind, fields: Partial<SessionProfile> = {}) {
  await act(async () => root.render(createElement(SessionDialog, {
    initial: { id: "", name: "test", kind, ...fields },
    onClose: vi.fn(),
  })));
}

async function click(text: string) {
  const button = Array.from(container.querySelectorAll("button"))
    .find((button) => button.textContent?.trim() === text);
  expect(button).toBeDefined();
  await act(async () => button!.click());
}

async function fill(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = element instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("session startup commands", () => {
  it.each<SessionKind>(["ssh", "local"])("saves multiline input and zero delay for %s", async (kind) => {
    await render(kind);
    const command = container.querySelector("textarea")!;
    const delay = container.querySelector<HTMLInputElement>('input[min="0"]')!;
    expect(delay.value).toBe("500");
    const script = "  echo first\nssh my-aws-host\n";
    await fill(command, script);
    await fill(delay, "0");
    await click("Connect");
    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      startupCommand: script, startupDelayMs: 0,
    }));
    expect(openSession).toHaveBeenCalledWith(expect.objectContaining({
      startupCommand: script, startupDelayMs: 0,
    }));
  });

  it("loads saved settings and allows disabling a command", async () => {
    await render("local", { startupCommand: "pwd\nls", startupDelayMs: 1250 });
    expect(container.querySelector("textarea")!.value).toBe("pwd\nls");
    expect(container.querySelector<HTMLInputElement>('input[min="0"]')!.value).toBe("1250");
    await fill(container.querySelector("textarea")!, " \n ");
    await click("Save");
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ startupCommand: null }));
    expect(openSession).not.toHaveBeenCalled();
  });

  it.each(["-1", "1.5", "4294967296"])("rejects invalid delay %s before saving", async (delay) => {
    await render("ssh", { startupCommand: "pwd" });
    await fill(container.querySelector<HTMLInputElement>('input[min="0"]')!, delay);
    await click("Save");
    expect(save).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Startup delay");
  });

  it.each<SessionKind>(["telnet", "serial", "ftp", "sftp"])("does not offer startup commands for %s", async (kind) => {
    await render(kind, { startupCommand: "must not run", startupDelayMs: 0, baudRate: 115200 });
    expect(container.querySelector("textarea")).toBeNull();
    await click("Save");
    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      startupCommand: null, startupDelayMs: null,
    }));
  });
});
