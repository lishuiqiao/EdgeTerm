import { suggestAiCommand } from "./api";

export interface AiConfig {
  baseUrl: string;
  model: string;
  shell: string;
  additionalRules?: string;
  strictOutput?: boolean;
  apiKey?: string | null;
  hasApiKey: boolean;
}
export type AiPreview = { input: string; command: string | null; pending: boolean };

/** A manual request owns one immutable input revision. Invalidated replies never reappear. */
export class ManualAiSuggestion {
  private revision = 0;
  value: AiPreview | null = null;
  constructor(private changed: (value: AiPreview | null) => void,
    private error: (message: string) => void,
    private request = (input: string, shell: string) => suggestAiCommand(input, shell)) {}
  clear = () => {
    this.revision += 1;
    this.value = null;
    this.changed(null);
  };
  async generate(input: string, shellHint: string) {
    if (this.value?.pending) return;
    const revision = ++this.revision;
    this.value = { input, command: null, pending: true };
    this.changed(this.value);
    try {
      const command = await this.request(input, shellHint);
      if (revision !== this.revision) return;
      // Defence in depth: no terminal control bytes or implicit execution.
      if (!command || /[\x00-\x1f\x7f-\x9f\u2028\u2029]/u.test(command)) throw new Error("Invalid command returned by AI");
      this.value = { input, command, pending: false };
      this.changed(this.value);
    } catch (error) {
      if (revision !== this.revision) return;
      this.clear();
      this.error(String(error));
    }
  }
  take(input: string): string | null {
    const value = this.value;
    const command = value && !value.pending && value.input === input ? value.command : null;
    this.clear();
    return command;
  }
}
export function previewText(value: AiPreview): string {
  if (value.pending) return "  Generating…";
  const command = value.command ?? "";
  return (command.startsWith(value.input) ? command.slice(value.input.length) : `  → ${command}`) + "  [Tab to accept · Esc to dismiss]";
}
