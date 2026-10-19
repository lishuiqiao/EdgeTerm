import { matchAppShortcut } from "./shortcuts";

/** Route search before focused inputs or xterm can consume the key. */
export function installSearchShortcuts(
  findInFiler: (next: boolean | "previous") => boolean,
  findInTerminal: (next: boolean | "previous") => void,
): () => void {
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
    // Dialogs (especially shortcut recording) own their keyboard input.
    if (document.querySelector(".dialog-backdrop, [aria-modal='true']")) return;
    const target = event.target instanceof Element ? event.target : null;
    // AI owns its shortcut only in command editors. Search keeps the same
    // chord in search fields and elsewhere, even when the mouse is over Filer.
    if (target?.closest(".xterm, .sender-command-input") &&
      matchAppShortcut(event)?.kind === "aiSuggest") return;
    const action = matchAppShortcut(event, "search");
    if (action?.kind !== "find" && action?.kind !== "findNext" && action?.kind !== "findPrevious") return;
    event.preventDefault();
    event.stopPropagation();
    const next = action.kind === "findPrevious" ? "previous" : action.kind === "findNext";
    if (!findInFiler(next)) findInTerminal(next);
  };
  window.addEventListener("keydown", onKeyDown, true);
  return () => window.removeEventListener("keydown", onKeyDown, true);
}
