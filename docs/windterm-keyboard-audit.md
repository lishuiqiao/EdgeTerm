# WindTerm keyboard compatibility audit

Reference: the installed **WindTerm 2.6.0 macOS x86_64** application at
`/Applications/工作台/WindTerm.app`, inspected on 2026-10-16. This is a comparison
with that artifact, not a claim about later WindTerm releases.

## Evidence and limits

REA opened the native target and inventoried the application bundle:

- Executable SHA-256: `7b38da7488f57bdc7e751b467d9715be27a53bde305902f2f87e6ab6be8a8f91`.
- Inventory Evidence: `ev_9baac0263d6e9104de784ef50af3e1aee00e484ec65777419b14e86487c35597`.
- Inspection Evidence: `ev_d7e7cddfdfc6ee03e531cdf796cda4969e7bfc16090aee3a2bdfa7855b6f012e`.
- `Contents/MacOS/global/wind.keymaps`: SHA-256
  `3554a5e540084bdab8b21b8bfa5fc2508e6e115b82243927a480843d3ee2bd72`.
- `Contents/MacOS/terminal/terms/xterm-256color.term`: SHA-256
  `217dc243fd2e597a68db3a8104c093eb5f514988357dcda26c87c8066d46ca9f`.

The inventory establishes artifact identity and resource presence. Direct local
parsing of the shipped resources establishes 518 keymap entries, including
editor, widget, local, command, and remote contexts. These are **not** 518
global terminal shortcuts. The resource scripts were not copied into EdgeTerm.
The large complete REA result was exported to `/tmp/edgeterm-windterm-evidence.json`
and inspected locally; the native session was then closed.

Native decompilation was unavailable in the connected provider configuration;
the separate REA plist helper also returned an execution error. The version was
read with the local plist reader instead. No WindTerm process or live remote
session was exercised. Resource declarations, EdgeTerm runtime tests, and the
zsh PTY experiment are distinct evidence; global behavioral equivalence is not
established by a static keymap comparison.

## Findings

1. EdgeTerm already delegated ordinary arrows, Ctrl letters, Alt/Option letters,
   Delete, Tab, Shift+Tab, F1–F12 and their modifiers to xterm.js. Most terminal
   editing keys were not missing.
2. macOS Fn+Left/Right produces Home/End. Both xterm.js and WindTerm's xterm
   resource use `ESC [ H/F`, with `ESC O H/F` in application-cursor mode. Clean
   macOS zsh had no bindings for these sequences. This explains the reported
   symptom without attributing a different Home encoding to WindTerm.
3. EdgeTerm's special Alt-arrow/Backspace conversion preceded application-key
   matching, so a user binding could send terminal bytes and trigger an app
   action. The matching priority is corrected.
4. Application dispatch did not consistently respect modal dialogs, composition
   or already-consumed events. The ownership gates are now consistent. Browser
   reload suppression runs after panel handling so F5 refresh and F5 rebinding
   work while WebView reload stays blocked.

## Supported compatibility keys

Existing EdgeTerm default shortcuts remain available. WindTerm compatibility
aliases below apply while their action retains its default binding; explicitly
rebinding or unassigning an action retires its aliases. User bindings take
priority. The shortcut dialog displays aliases and permits F-key bindings.

`Mod` below means Ctrl or, where specified, Command on macOS. Modifier names in
the resource are interpreted explicitly; native macOS reserved shortcuts remain
owned by the operating system.

| Scope | Keys | Action |
| --- | --- | --- |
| Terminal | Ctrl+Shift+C/V/A/W; macOS also Command+Shift+C/V/A/W | Copy, paste, select all, close session |
| Terminal | Ctrl+Insert / Shift+Delete / Shift+Insert | Copy / copy / paste |
| Search | Alt+F3 / Alt+Shift+F3; macOS Command+G / Command+Shift+G | Next / previous result; Filer when hovered |
| Terminal | Ctrl+Shift+D | Duplicate the current session profile into a new connection |
| Terminal | Ctrl+L; macOS Command+L | Send Ctrl+L for application redraw |
| Terminal | Ctrl+Shift+L; macOS also Command+Shift+L | Clear the buffer using EdgeTerm's existing clear operation |
| Terminal | Ctrl+Shift+X; macOS also Command+Shift+X | Paste selection through the existing multiline confirmation |
| Terminal | Ctrl+minus/equal/plus; macOS also Command equivalents | Decrease / increase terminal font |
| Terminal | Ctrl+Shift+Up/Down, PageUp/PageDown, Home/End; macOS also Command+Shift equivalents | Scroll line, page, or buffer edge without sending input |
| Terminal | F13–F20 | Standard xterm function-key sequences, supplementing xterm.js F1–F12 |
| Ended terminal | Enter / Ctrl+D | Reconnect / close; connected sessions still receive Enter and Ctrl+D |
| Window | Alt+N, Alt+LeftBracket/RightBracket | New / previous / next session |
| Window | Alt+W, then Alt+S/F/X | Toggle Session / Filer / Sender |
| Window | Alt+W, then Alt+H/V | Split down / right |
| Display | Alt+T, then Alt+N/T | Toggle line numbers / timestamps |
| Filer list | Enter / Backspace / Delete / F2 / F5 | Open / parent / confirmed delete / rename / refresh |
| Filer list | F3 / F4 | Remote download/upload; local copy to/from a chosen directory/source |
| Filer list | F7 / F8 / Alt+D | Paste directory into terminal / reveal terminal directory / focus address |
| Filer list | Ctrl or Command+C, Shift+C, N, Shift+N, P, Shift+P | Copy names/paths, create file/directory, paste names/paths into terminal |
| FTP/SFTP lists | Enter / Backspace / Delete / F2 / F5 / Alt+D / Mod+Shift+N | Open / parent / confirmed delete / rename / refresh / address / new directory |
| FTP/SFTP remote list | F3 / F4 | Download / upload via existing transfer flow |
| Session list | Enter / Alt+Enter / Ctrl or Command+D / Delete | Connect / edit / duplicate / confirmed delete |
| Sender | Alt+Enter / Alt+Q / Alt+X | Send / stop / clear input |

Panel keys require focus inside the relevant list. Hover alone changes only
search routing; it never authorizes a Delete action in another panel. Inputs,
rename editors, dialogs and composition retain their own keys. Two-stroke
prefixes expire after 1.5 seconds and cancel on Escape or focus change.

## macOS Home/End adaptation

With **Edit → Home/End Line Editing** enabled, unmodified Home/End in the normal
buffer with application-cursor mode off send Ctrl+A/E. This is an explicit shell
compatibility adaptation beyond WindTerm's standard xterm resource. Alternate
screen/application-cursor programs and modified Home/End retain their sequences.
The preference persists and travels with configuration exports.

A TUI that uses neither mode cannot be distinguished from a shell using these
signals. Turn this option off for such programs, or when exact terminal Home/End
encoding is required. Shell vi mode and custom readline/zsh bindings can also
change what Ctrl+A/E means. This is not an implementation of WindTerm's separate
local Vim browsing mode.

## Remaining differences

- EdgeTerm has no separate local/command Vim mode for browsing terminal output,
  folding, multi-selection, editor snippets, or macros. Those mode-specific
  bindings are not installed as global keys that would steal Vim/Shell input.
- Filer history, automatic directory synchronization, MoveTo UI, link creation
  and a properties dialog remain absent; their WindTerm keys are not advertised.
- WindTerm-specific command-boundary navigation/selection, saved-view reopening,
  focus mode, tunnel/trigger editors and multiple Sender instances are not
  reproduced by this change.
- EdgeTerm's tab-number model remains its existing numbered tabs, and old
  EdgeTerm shortcuts remain aliases/defaults. This is not an identical export
  of WindTerm's entire keyboard configuration or a port of its script engine.
- Protocol-specific differences such as configurable Backspace remain controlled
  by EdgeTerm session settings. Existing Option-arrow word navigation remains.

## Verification

Tests dispatch real keyboard events through xterm's textarea and inspect onData,
including normal/alternate/application modes, modifiers, IME, F13–F20, custom
bindings, clipboard confirmation and scrolling. Application/panel tests cover
focus ownership, search routing, prefix cancellation, reload prevention and
existing mutation confirmations. Alias tests cover macOS and Windows/Linux.

A clean `/bin/zsh -dfi` PTY with temporary ZDOTDIR and `bindkey -e` confirmed that
Ctrl+A/E moves the editing position: inserting a prefix and suffix around `BC`
produced the executed output `ABCD`. User shell configuration was not read.
