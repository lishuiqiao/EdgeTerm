import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { previewAppData } from "../api";
import { describeData, exportAppData, importAppData } from "../dataTransfer";
import type { BackupPreview } from "../types";

export type DataTransferRequest = { mode: "export" } | { mode: "import"; path: string };

export function DataTransferDialog({ request, onClose }: {
  request: DataTransferRequest;
  onClose: () => void;
}) {
  const exporting = request.mode === "export";
  const path = request.mode === "import" ? request.path : null;
  const [includeCredentials, setIncludeCredentials] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [preview, setPreview] = useState<BackupPreview | null>(null);
  const [busy, setBusy] = useState(!exporting);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(!exporting);
  const passwordRef = useRef<HTMLInputElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLFormElement>(null);
  const previousFocus = useRef(document.activeElement);

  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    void previewAppData(path).then((value) => {
      if (!cancelled) setPreview(value);
    }).catch((reason) => {
      if (!cancelled) setError(String(reason));
    }).finally(() => {
      if (!cancelled) { busyRef.current = false; setBusy(false); }
    });
    return () => { cancelled = true; };
  }, [path]);

  const needsPassword = exporting ? includeCredentials : preview?.encrypted && !preview.data;
  useEffect(() => {
    if (busy) return;
    if (needsPassword) passwordRef.current?.focus();
    else primaryRef.current?.focus();
  }, [needsPassword, busy]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (!busyRef.current) onClose();
      } else if (event.key === "Tab") {
        const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
          "input:not(:disabled), button:not(:disabled)",
        ) ?? []);
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (first && last && (event.shiftKey ? document.activeElement === first : document.activeElement === last)) {
          event.preventDefault();
          (event.shiftKey ? last : first).focus();
        }
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      const previous = previousFocus.current;
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [onClose]);

  const submit = async () => {
    if (busyRef.current) return;
    setError(null);
    if (exporting && includeCredentials) {
      if ([...password].length < 8 || !password.trim()) {
        setError("Use an export password of at least 8 characters.");
        return;
      }
      if (password !== confirmation) {
        setError("The passwords do not match.");
        return;
      }
    }
    busyRef.current = true;
    setBusy(true);
    try {
      if (exporting) {
        if (await exportAppData(includeCredentials ? password : null)) onClose();
      } else if (path && !preview?.data) {
        setPreview(await previewAppData(path, preview?.encrypted ? password : null));
      } else if (path && preview?.data) {
        await importAppData(path, preview, preview.encrypted ? password : null);
        onClose();
      }
    } catch (reason) {
      setError(String(reason));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const data = preview?.data;
  return createPortal(
    <div className="dialog-backdrop" onMouseDown={() => { if (!busyRef.current) onClose(); }}>
      <form
        ref={dialogRef}
        className="dialog data-transfer-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="data-transfer-title"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
        onSubmit={(event) => { event.preventDefault(); void submit(); }}
      >
        <div className="dialog-header" id="data-transfer-title">{exporting ? "Export Data" : "Import Data"}</div>
        <div className="dialog-body data-transfer-body">
          {exporting ? <>
            <p>Export sessions, groups, Sender commands and application settings.</p>
            <label className="data-transfer-option">
              <input type="checkbox" checked={includeCredentials} disabled={busy}
                onChange={(event) => {
                  setIncludeCredentials(event.target.checked);
                  setPassword(""); setConfirmation(""); setError(null);
                }} />
              Include login passwords and private key passphrases
            </label>
            <p className="data-transfer-hint">{includeCredentials
              ? "The entire file will be encrypted with your export password. Keep it safe: a forgotten password cannot be recovered."
              : "The file is readable JSON. Saved login passwords and private key passphrases are excluded."}</p>
          </> : <>
            <p className="data-transfer-path">{path}</p>
            {!preview && <p>{busy ? "Reading backup…" : "Could not read this backup. Retry or choose another file."}</p>}
            {preview?.encrypted && !data && <p>This backup is encrypted. Enter the password set when it was exported.</p>}
            {data && <>
              <p>Import {describeData({ profiles: data.profiles.length, groups: data.groups.length, senderCommands: data.senderCommands.length })}{data.settings ? " and settings" : ""}?</p>
              <p className="data-transfer-hint">Entries with the same ID replace local entries; other entries are kept.</p>
              <p className="data-transfer-hint">{preview.encrypted
                ? "Saved credentials in this backup replace credentials for matching sessions and are encrypted again on this device. Sessions without credentials in the backup keep any locally saved credentials."
                : "This file does not import saved passwords. Existing local credentials are kept; new sessions may ask for a password."}</p>
            </>}
          </>}
          {needsPassword && <label className="data-transfer-field">
            Export password
            <input ref={passwordRef} type="password" aria-label="Export password"
              autoComplete={exporting ? "new-password" : "off"} spellCheck={false}
              value={password} disabled={busy} maxLength={1024}
              onChange={(event) => setPassword(event.target.value)} />
          </label>}
          {exporting && includeCredentials && <label className="data-transfer-field">
            Confirm password
            <input type="password" aria-label="Confirm password" autoComplete="new-password"
              value={confirmation} disabled={busy} maxLength={1024}
              onChange={(event) => setConfirmation(event.target.value)} />
          </label>}
          {(includeCredentials || preview?.encrypted) && <p className="data-transfer-hint">
            Private key files are not included. Copy them separately and adjust their paths on the destination device.
          </p>}
          {error && <div className="dialog-error" role="alert">{error}</div>}
        </div>
        <div className="dialog-footer">
          <button type="button" className="btn" disabled={busy} onClick={onClose}>Cancel</button>
          <button ref={primaryRef} type="submit" className="btn is-primary"
            disabled={busy || (!exporting && Boolean(needsPassword) && !password)}>
            {busy ? "Working…" : exporting ? "Export…" : data ? "Import" : preview?.encrypted ? "Unlock" : "Retry"}
          </button>
        </div>
      </form>
    </div>, document.body,
  );
}
