<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/logo-dark.png">
    <img src="docs/logo.png" alt="EdgeTerm" width="480">
  </picture>
</p>

<p align="center">
  <a href="https://github.com/miskin-lee/EdgeTerm/stargazers"><img alt="GitHub stars" src="https://img.shields.io/github/stars/miskin-lee/EdgeTerm?style=flat"></a>
  <a href="https://qm.qq.com/q/oINZ2ffDOg"><img alt="Join the EdgeTerm QQ group: 1129162865" src="https://img.shields.io/badge/QQ%20group-Join%20discussion-12B7F5?style=flat"></a>
  <a href="https://github.com/lishuiqiao/EdgeTerm/releases"><img alt="GitHub release downloads" src="https://img.shields.io/github/downloads/lishuiqiao/EdgeTerm/total?style=flat&amp;label=downloads"></a>
  <a href="https://github.com/lishuiqiao/EdgeTerm/releases/latest"><img alt="Latest GitHub release" src="https://img.shields.io/github/v/release/lishuiqiao/EdgeTerm?style=flat"></a>
  <a href="LICENSE"><img alt="GPL-3.0 license" src="https://img.shields.io/github/license/miskin-lee/EdgeTerm?style=flat"></a>
  <a href="https://github.com/miskin-lee/EdgeTerm/graphs/contributors"><img alt="GitHub contributors" src="https://img.shields.io/github/contributors/miskin-lee/EdgeTerm?style=flat"></a>
</p>

[English](README.md) | [简体中文](README.zh-CN.md)

A small, fast terminal, SSH, Telnet, SFTP, FTP and serial client built with **Rust + Tauri**. Installers are about 4–5 MB.

> [!TIP]
> <a href="https://github.com/miskin-lee/serialX"><img src="https://raw.githubusercontent.com/miskin-lee/serialX/main/assets/icons/png/serialx-64.png" alt="serialX" width="20" height="20" align="top"></a> Doing embedded work and debugging devices over a serial port? Try **[serialX](https://github.com/miskin-lee/serialX)** from the same author, a workspace built for serial debugging.

<img src="docs/screenshot-dark.png" alt="EdgeTerm dark theme: split panes, colored log and switch output, Session tree, Filer and Sender" width="100%">

<img src="docs/screenshot-light.png" alt="EdgeTerm light theme: the same workspace" width="100%">

## Features

- **Sessions**: local shell, SSH, Telnet, SFTP, FTP and serial port, saved in a grouped tree you can filter, duplicate and import from `~/.ssh/config`.
- **SSH**: password, public key, ssh-agent and keyboard-interactive (MFA / one-time codes), jump hosts, and older network gear that only speaks legacy algorithms.
- **Readable output**: a timestamp and line-number gutter, and semantic coloring of IPs, URLs, log levels, HTTP methods, paths, sizes and more.
- **Split panes and tabs**: split right or down, drag tabs between panes, and see at a glance which background tab is busy or done.
- **Filer**: browse over SFTP, FTP or the local disk, with drag and drop to and from your desktop.
- **Sender**: saved commands and multi-line scripts, sent to one session or all of them, optionally on a timer.
- **File transfer in the terminal**: ZMODEM (`rz` / `sz`) and XMODEM.
- **Everyday details**: themes, fonts and cursor style, custom encodings and locale, session recording, Copy on Select, a warning before multi-line pastes, rebindable shortcuts, and export / import of all settings.

## Install

Download from [Releases](https://github.com/lishuiqiao/EdgeTerm/releases):

| Platform | Package |
| --- | --- |
| Windows x64 | Installer (`.exe`) or portable `.zip` |
| macOS Apple Silicon | `.dmg` |
| Linux x64 / ARM64 | `.AppImage`, `.deb` or `.rpm` |

- Builds are not notarized or Authenticode-signed, so the OS may warn on first launch.
- The portable zip keeps all its data in the `data` folder next to `EdgeTerm.exe`. Saved passwords do not carry over to another machine.
- The `.rpm` needs WebKitGTK 4.1 (Fedora has it). On older distributions, use the AppImage.
- Installed copies update themselves (**Help → Check for Updates…**). The portable copy only tells you a new version is out.

## Auto Update

This fork uses its own updater signing key and the releases at
`lishuiqiao/EdgeTerm`. Install a release from this fork to follow its update
channel; an upstream installation continues to use the upstream channel.

The **Release** GitHub Actions workflow builds signed update bundles and
publishes them only after every platform and the update manifest pass its
checks. Repository secrets `TAURI_SIGNING_PRIVATE_KEY` and
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` must contain the fork's updater key and
password. Keep a secure backup of both; never commit them. The corresponding
public key and update endpoint live in `src-tauri/tauri.conf.json`.

These signatures secure application updates; they do not provide Apple
notarization or Windows Authenticode signing.

## Getting started

1. **Session → New Session…** (`⌘N` / `Alt+N`) creates a session; double-click it in the Session panel to connect. Right-click a session to edit, duplicate, move or delete it.
2. The **Filer** on the right follows the active tab. Drop files onto it to upload, drag entries out to download, or press `⌘J` / `Ctrl+Shift+J` to jump to the shell's working directory. The search icon to the left of New file finds and highlights file and folder names in the current directory, ignoring case without searching subdirectories. Enter / Shift+Enter cycles matches; Esc closes search. While hovering over Filer, `⌘F` / `Ctrl+Shift+F` searches file names; elsewhere it searches terminal text. `⌘G` / `Ctrl+Shift+G` follows the same pointer-based routing for the next match.
3. The **Sender** at the bottom sends text to the current session or to all sessions. Save frequently used commands as tags.
4. **Split Right / Split Down** is on the tab's context menu and in **View**. Drag a tab onto another pane to move it there.
5. **Edit** holds the copy/paste behavior (right click, Copy on Select, OSC 52), and **View** holds the theme, fonts and **Keyboard Shortcuts…**.

### Commands after connecting

Create or edit an **SSH / Shell** session and enter one or more lines under **Startup command → Command**. Leave it blank to disable. **Startup delay (ms)** defaults to 500 milliseconds and accepts 0. The command runs once per opened, reconnected or duplicated session; switching tabs does not run it again. Closing during the delay cancels it.

The delay starts when the server accepts the remote shell for SSH, or when the local shell process starts. Lines are typed as terminal input, with Enter appended to the last line if needed. The delay does not detect prompts or wait for individual commands to finish; increase it for slow shell initialization. Commands are saved and exported with the profile.

For AWS Session Manager / `ProxyCommand`, configure a host alias in your system SSH config, then create a **Shell** session with `ssh my-aws-host` as its startup command (replace the alias). This uses local OpenSSH and your installed AWS tools. It remains a local Shell session, so the built-in remote SFTP panel does not attach to that connection. Native `ProxyCommand` support in the built-in SSH client is outside this feature.

## Keyboard shortcuts

| macOS | Windows / Linux | Action |
| --- | --- | --- |
| `⌘N` | `Alt+N` | New session |
| `⌘W` | `Ctrl+Shift+W` | Close session |
| `⌘F` / `⌘G` | `Ctrl+Shift+F` / `Ctrl+Shift+G` | Find / find next |
| `⌘K` | `Alt+K` | Clear screen |
| `⌘J` | `Ctrl+Shift+J` | Show the working directory in the Filer |
| `⌘[` / `⌘]` | `Alt+[` / `Alt+]` | Previous / next tab |
| `⌘1`–`⌘9` | `Alt+1`–`Alt+9` | Go to tab N |
| `⌘\` / `⌘⇧\` | `Ctrl+Shift+\` / `Ctrl+Alt+\` | Split right / down |
| `⌘⌥[` / `⌘⌥]` | `Ctrl+Alt+[` / `Ctrl+Alt+]` | Previous / next pane |
| `⌘⌥←` / `⌘⌥→` / `⌘⌥↓` | `Ctrl+Alt+←` / `→` / `↓` | Toggle Session / Filer / Sender |
| `⌘C` / `⌘V` / `⌘A` | `Ctrl+Shift+C` / `V` / `A` | Copy / paste / select all |

All except the tab numbers can be changed in **View → Keyboard Shortcuts…**.

## License

EdgeTerm is licensed under the [GNU General Public License v3.0](LICENSE).

The interface icons are [Codicons](https://github.com/microsoft/vscode-codicons) by Microsoft, used under the Creative Commons Attribution 4.0 license.

The name “EdgeTerm” and its icon are not covered by the open-source license above. Copyright © 2026 miskin. All rights reserved.
