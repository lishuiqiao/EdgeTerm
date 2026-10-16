import type { KeyboardEvent } from "react";

/** Tree shortcuts belong to focused rows, never to editors or modal dialogs. */
export function panelKey(event: KeyboardEvent<HTMLElement>): string | null {
  if (event.defaultPrevented || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return null;
  if (document.querySelector(".dialog-backdrop, [aria-modal='true'], [role='menu']")) return null;
  const target = event.target;
  if (!(target instanceof HTMLElement) || target.closest("input, textarea, select, button, [contenteditable]:not([contenteditable='false']), [role='textbox']")) return null;
  if (event.ctrlKey && event.metaKey) return null;
  // Option+letter produces characters such as ∂ on macOS; shortcuts still
  // identify the physical letter key, as the application's shortcut table does.
  const key = /^Key[A-Z]$/.test(event.code) ? event.code.slice(3).toLowerCase()
    : /^[a-z]$/i.test(event.key) ? event.key.toLowerCase() : event.key;
  return `${event.ctrlKey || event.metaKey ? "Mod+" : ""}${event.altKey ? "Alt+" : ""}${event.shiftKey ? "Shift+" : ""}${key}`;
}

export function consumePanelKey(event: KeyboardEvent<HTMLElement>) {
  event.preventDefault();
  event.stopPropagation();
}
