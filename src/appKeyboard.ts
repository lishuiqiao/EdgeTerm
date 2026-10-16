import { matchAppShortcut, matchUserShortcut, shortcutUsesDefault, type AppShortcut, type ShortcutCommand } from "./shortcuts";

/** Modal dialogs and ordinary editors own their keys, even on a focused button. */
export function appKeyboardBlocked(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return true;
  if (document.querySelector(".dialog-backdrop, [aria-modal='true']")) return true;
  const target = event.target instanceof Element ? event.target : null;
  return !target?.closest(".xterm") && Boolean(target?.closest("input, textarea, select, [contenteditable='true']"));
}

export function closedSessionShortcut(event: KeyboardEvent, state: string): "reconnect" | "close" | null {
  if ((state !== "closed" && state !== "error") || appKeyboardBlocked(event) || matchAppShortcut(event)) return null;
  if (event.key === "Enter" && !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey) return "reconnect";
  if (event.code === "KeyD" && event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey) return "close";
  return null;
}

/** Run after pane handlers so preventing WebView reload does not disable F5. */
export function installBrowserReloadGuard(): () => void {
  const onKey = (event: KeyboardEvent) => {
    const reload = event.key === "F5" || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "r");
    if (!reload || event.defaultPrevented) return;
    const action = matchAppShortcut(event);
    const global = action && !["copy", "paste", "selectAll", "clearScreen", "pasteSelection", "scrollTerminal"].includes(action.kind);
    if (!(global && !appKeyboardBlocked(event))) event.preventDefault();
  };
  document.addEventListener("keydown", onKey);
  return () => document.removeEventListener("keydown", onKey);
}

type SequenceEntry = { command?: ShortcutCommand; action: AppShortcut };
const WINDOW_SEQUENCES: Record<string, SequenceEntry> = {
  KeyS: { command: "panelSessions", action: { kind: "togglePanel", panel: "sessions" } },
  KeyF: { command: "panelFiler", action: { kind: "togglePanel", panel: "filer" } },
  KeyX: { command: "panelSender", action: { kind: "togglePanel", panel: "sender" } },
  KeyH: { command: "splitDown", action: { kind: "splitPane", side: "down" } },
  KeyV: { command: "splitRight", action: { kind: "splitPane", side: "right" } },
};

const SEQUENCES: Record<string, Record<string, SequenceEntry>> = {
  KeyW: WINDOW_SEQUENCES,
  KeyT: {
    KeyN: { action: { kind: "toggleGutter", field: "line" } },
    KeyT: { action: { kind: "toggleGutter", field: "time" } },
  },
};
const sequenceEnabled = (entry: SequenceEntry) => !entry.command || shortcutUsesDefault(entry.command);

/** WindTerm's window/display sequences, plus ordinary app dispatch. */
export function installAppKeyboard(dispatch: (shortcut: AppShortcut, event: KeyboardEvent) => void): () => void {
  let pending: { prefix: string; target: EventTarget | null; until: number } | null = null;
  const reset = () => { pending = null; };
  const capture = (event: KeyboardEvent) => {
    if (appKeyboardBlocked(event)) { reset(); return; }
    if (/^(Alt|Control|Shift|Meta)(Left|Right)$/.test(event.code)) return;
    const alt = event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
    const prefix = pending;
    reset();
    if (prefix && prefix.until >= Date.now() && prefix.target === event.target) {
      if (event.key === "Escape") {
        event.preventDefault(); event.stopPropagation(); return;
      }
      const entry = alt ? SEQUENCES[prefix.prefix]?.[event.code] : undefined;
      // Explicit single-key bindings take priority over compatibility sequences.
      if (entry && sequenceEnabled(entry) && !matchUserShortcut(event)) {
        event.preventDefault(); event.stopPropagation();
        dispatch(entry.action, event);
        return;
      }
    }
    if (alt && SEQUENCES[event.code] && !matchAppShortcut(event) &&
      Object.values(SEQUENCES[event.code]).some(sequenceEnabled)) {
      if (event.repeat) {
        pending = prefix;
        event.preventDefault(); event.stopPropagation();
        return;
      }
      pending = { prefix: event.code, target: event.target, until: Date.now() + 1500 };
      event.preventDefault(); event.stopPropagation();
    }
  };
  const bubble = (event: KeyboardEvent) => {
    if (appKeyboardBlocked(event)) return;
    const shortcut = matchAppShortcut(event);
    if (shortcut) dispatch(shortcut, event);
  };
  window.addEventListener("keydown", capture, true);
  window.addEventListener("keydown", bubble);
  window.addEventListener("blur", reset);
  window.addEventListener("focusin", reset);
  return () => {
    window.removeEventListener("keydown", capture, true);
    window.removeEventListener("keydown", bubble);
    window.removeEventListener("blur", reset);
    window.removeEventListener("focusin", reset);
  };
}
