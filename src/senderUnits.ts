import { t } from "./i18n";
import type { LineEnding } from "./types";

// What the Sender writes for one command: the text line by line, each line
// with the chosen ending, so a multi-line script runs one line per prompt
// (`senderSend.ts` waits for each prompt).

export type SendUnit = string;

/**
 * The lines of the command box. Blank lines are skipped: they would only
 * send bare Enters, and a script pasted with a trailing newline should not
 * end with one either.
 */
export function splitLines(text: string): string[] {
  return text.split(/\r?\n/).filter((line) => line.trim().length > 0);
}

/** The first line of the command box, as a name for the whole of it. */
export function firstLine(text: string): string {
  return splitLines(text)[0] ?? text;
}

export function buildUnits(text: string, ending: LineEnding): SendUnit[] {
  return splitLines(text).map((line) => `${line}${endingText(ending)}`);
}

export function endingText(ending: LineEnding): string {
  if (ending === "lf") return "\n";
  if (ending === "crlf") return "\r\n";
  return "";
}

export function endingLabel(ending: LineEnding): string {
  if (ending === "lf") return "append \\n";
  if (ending === "crlf") return "append \\r\\n";
  return t("no line ending");
}
