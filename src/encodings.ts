import { t } from "./i18n";
/**
 * Character encodings a terminal session can be in.
 *
 * xterm.js reads UTF-8 only. A session in another encoding has its output
 * decoded here before it is written (`TerminalController.feed`, after the
 * ZMODEM / XMODEM sentries have seen the raw bytes) and its keyboard input
 * encoded by the backend (`write_session`; see `session/encoding.rs`). The
 * labels are WHATWG encoding labels, which `TextDecoder` and the backend's
 * encoding_rs both resolve, so the two directions always agree.
 */

export interface TerminalEncoding {
  label: string;
  name: string;
}

export const DEFAULT_ENCODING = "utf-8";

/** What the session dialog offers; `label` is what a profile stores. */
export const TERMINAL_ENCODINGS: readonly TerminalEncoding[] = [
  { label: DEFAULT_ENCODING, name: "UTF-8" },
  { label: "gb18030", get name() { return t("GB18030 — Chinese (Simplified)"); } },
  { label: "gbk", get name() { return t("GBK — Chinese (Simplified)"); } },
  { label: "big5", get name() { return t("Big5 — Chinese (Traditional)"); } },
  { label: "shift_jis", get name() { return t("Shift_JIS — Japanese"); } },
  { label: "euc-jp", get name() { return t("EUC-JP — Japanese"); } },
  { label: "euc-kr", get name() { return t("EUC-KR — Korean"); } },
  { label: "windows-1252", get name() { return t("Windows-1252 / ISO-8859-1 — Western"); } },
  { label: "windows-1251", get name() { return t("Windows-1251 — Cyrillic"); } },
  { label: "koi8-r", get name() { return t("KOI8-R — Cyrillic"); } },
];

/** A profile's label as stored: trimmed, lower-case, empty for UTF-8. */
export function encodingLabel(label: string | null | undefined): string {
  return (label ?? "").trim().toLowerCase() || DEFAULT_ENCODING;
}

/**
 * A streaming decoder for a session's output, or null when the bytes can go
 * to xterm as they are: UTF-8, a label this webview does not know, or
 * UTF-16, which cannot carry a terminal's control bytes. The backend treats
 * exactly those labels as UTF-8 too (`session/encoding.rs`).
 */
export function createOutputDecoder(
  label: string | null | undefined,
): TextDecoder | null {
  const wanted = encodingLabel(label);
  if (wanted === DEFAULT_ENCODING) return null;
  let decoder: TextDecoder;
  try {
    decoder = new TextDecoder(wanted);
  } catch {
    return null;
  }
  if (decoder.encoding === DEFAULT_ENCODING || decoder.encoding.startsWith("utf-16")) {
    return null;
  }
  return decoder;
}

/**
 * What the Locale field accepts: `en_US.UTF-8`, `C.UTF-8`, `de_DE@euro` —
 * letters, digits and the separators locale names use. Mirrors
 * `is_locale_name` in the backend, which refuses anything else.
 */
export const LOCALE_NAME = /^[A-Za-z0-9_.@-]{1,64}$/;

/** Offered by the Locale field; any name the far end has installed works. */
export const LOCALE_SUGGESTIONS = ["en_US.UTF-8", "C.UTF-8", "zh_CN.UTF-8"];
