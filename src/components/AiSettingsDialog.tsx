import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getAiConfig, saveAiConfig, testAiConfig } from "../api";
import type { AiConfig } from "../aiSuggestion";
import { chordLabel } from "../shortcuts";
import { useStore } from "../store";

export function AiSettingsDialog({ onClose }: { onClose: () => void }) {
  const [config, setConfig] = useState<AiConfig>({ baseUrl: "", model: "", shell: "", hasApiKey: false });
  const [key, setKey] = useState("");
  const [clearKey, setClearKey] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [loadFailed, setLoadFailed] = useState(false);
  const enabled = useStore(s => s.aiSuggestionsEnabled);
  const [enable, setEnable] = useState(enabled);
  const shortcut = useStore(s => s.shortcuts.aiSuggest);
  const form = useRef<HTMLFormElement>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    const previous = document.activeElement;
    getAiConfig().then(value => { if (alive.current) setConfig(value); })
      .catch(e => { if (alive.current) { setMessage(String(e)); setLoadFailed(true); } })
      .finally(() => { if (alive.current) setLoading(false); });
    return () => { alive.current = false; if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  useEffect(() => { if (!loading) form.current?.querySelector("input")?.focus(); }, [loading]);
  const value = () => ({ ...config, apiKey: clearKey ? "" : key || null });
  const run = async (test: boolean) => {
    if (busy || loading || loadFailed) return;
    setBusy(true); setMessage("");
    try {
      if (test) { await testAiConfig(value()); if (alive.current) setMessage("Connection successful. Model returned a command."); }
      else {
        await saveAiConfig(value());
        const store = useStore.getState();
        store.invalidateAiConfig();
        store.setAiSuggestionsEnabled(enable);
        if (alive.current) onClose();
      }
    } catch (e) { if (alive.current) setMessage(String(e)); }
    finally { if (alive.current) setBusy(false); }
  };
  return createPortal(<div className="dialog-backdrop" onMouseDown={e => e.stopPropagation()}>
    <form ref={form} className="dialog data-transfer-dialog" role="dialog" aria-modal="true" aria-labelledby="ai-settings-title"
      onSubmit={e => { e.preventDefault(); void run(false); }} onKeyDown={e => {
        e.stopPropagation();
        if (e.key === "Escape" && !busy) { e.preventDefault(); onClose(); }
        if (e.key === "Tab") {
          const nodes = Array.from(form.current?.querySelectorAll<HTMLElement>("input:not(:disabled), select:not(:disabled), textarea:not(:disabled), button:not(:disabled)") ?? []);
          const first = nodes[0], last = nodes[nodes.length - 1];
          if (first && last && (e.shiftKey ? document.activeElement === first : document.activeElement === last)) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
        }
      }}>
      <div className="dialog-header" id="ai-settings-title">AI Command Suggestions</div>
      <div className="dialog-body data-transfer-body">
        <label className="data-transfer-option"><input type="checkbox" checked={enable} disabled={busy || loading} onChange={e => setEnable(e.target.checked)} />Enable AI suggestions (turns off Command Suggestions)</label>
        <label className="data-transfer-field">API Base URL<input required type="url" placeholder="https://your-service.example/v1" value={config.baseUrl} disabled={busy || loading} onChange={e => setConfig({ ...config, baseUrl: e.target.value })} /></label>
        <label className="data-transfer-field">Model<input required value={config.model} disabled={busy || loading} onChange={e => setConfig({ ...config, model: e.target.value })} /></label>
        <label className="data-transfer-field">API Key<input type="password" autoComplete="new-password" spellCheck={false} value={key} disabled={busy || loading || clearKey} placeholder={config.hasApiKey ? "Saved; leave blank to keep for the same URL" : "Optional for local services"} onChange={e => setKey(e.target.value)} /></label>
        {config.hasApiKey && <label className="data-transfer-option"><input type="checkbox" checked={clearKey} disabled={busy} onChange={e => setClearKey(e.target.checked)} />Remove saved API key</label>}
        <label className="data-transfer-field">Shell<select value={config.shell} disabled={busy || loading} onChange={e => setConfig({ ...config, shell: e.target.value })}>
          <option value="">Automatic / unknown remote shell</option>{["bash", "zsh", "sh", "fish", "powershell", "cmd"].map(s => <option key={s} value={s}>{s}</option>)}
        </select></label>
        <label className="data-transfer-field">Additional rules<textarea rows={3} maxLength={4000} value={config.additionalRules ?? ""} disabled={busy || loading} placeholder="Prefer built-in tools; prefer read-only commands" onChange={e => setConfig({ ...config, additionalRules: e.target.value })} /></label>
        <p className="data-transfer-hint">Preferences guide command selection. Built-in output rules remain fixed: one command or no suggestion, without explanations.</p>
        <label className="data-transfer-option"><input type="checkbox" checked={config.strictOutput ?? false} disabled={busy || loading} onChange={e => setConfig({ ...config, strictOutput: e.target.checked })} />Strict structured output (requires model support)</label>
        <p className="data-transfer-hint">Enable for services supporting JSON Schema. Otherwise leave off; responses are still validated locally. Invalid responses are discarded without automatic retries.</p>
        <p className="data-transfer-hint">Generate: {chordLabel(shortcut) || "Unassigned"}. Change this in Keyboard Shortcuts → Generate AI Command.</p>
        <p className="data-transfer-hint">Only a manual request sends your current input, shell type and additional rules to this service. Tab replaces the input without executing it. Editing dismisses the preview.</p>
        <p className="data-transfer-hint">OpenAI-compatible Chat Completions API. Keys are encrypted locally and included only in password-encrypted backups.</p>
        {message && <p role="status">{message}</p>}
      </div>
      <div className="dialog-footer">
        <button type="button" className="btn" disabled={loading || busy || loadFailed} onClick={() => void run(true)}>Test Connection</button>
        <button type="button" className="btn" disabled={busy} onClick={onClose}>Cancel</button>
        <button type="submit" className="btn is-primary" disabled={loading || busy || loadFailed}>{busy ? "Working…" : "Save"}</button>
      </div>
    </form>
  </div>, document.body);
}
