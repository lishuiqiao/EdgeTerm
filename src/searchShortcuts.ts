import { matchAppShortcut } from "./shortcuts";

/** Route search before focused inputs or xterm can consume the key. */
export function installSearchShortcuts(
  findInFiler: (next: boolean) => boolean,
  findInTerminal: (next: boolean) => void,
): () => void {
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing) return;
    // Dialogs (especially shortcut recording) own their keyboard input.
    if (document.querySelector(".dialog-backdrop, [aria-modal='true']")) return;
    const action = matchAppShortcut(event);
    if (action?.kind !== "find" && action?.kind !== "findNext") return;
    event.preventDefault();
    event.stopPropagation();
    const next = action.kind === "findNext";
    if (!findInFiler(next)) findInTerminal(next);
  };
  window.addEventListener("keydown", onKeyDown, true);
  return () => window.removeEventListener("keydown", onKeyDown, true);
}
