import { t } from "../i18n";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import * as api from "../api";
import { consumePanelKey, panelKey } from "./panels/panelKeyboard";
import {
  EMPTY_SELECTION,
  batchCollisions,
  batchItemName,
  clickMode,
  replacePrompt,
  selectEntry,
  selectedEntries,
  type FileSelection,
} from "../fileSelection";
import { ask } from "../nativeDialog";
import { IS_MAC, IS_WINDOWS } from "../platform";
import { FileIcon } from "./FileIcon";
import { Icon } from "./icons";
import { useStore, type Tab } from "../store";
import type { FileEntry } from "../types";

interface Props {
  tab: Tab;
  active: boolean;
}

interface TransferState {
  direction: "upload" | "download";
  name: string;
  transferred: number;
  total: number;
  status: "running" | "complete" | "error";
  message?: string;
}

interface FileBrowserProps {
  title: string;
  subtitle: string;
  path: string;
  draft: string;
  entries: FileEntry[];
  selection: FileSelection;
  loading: boolean;
  error: string | null;
  actions?: ReactNode;
  keyboardActions?: Record<string, (() => void) | undefined>;
  keyboardDisabled?: boolean;
  onDraftChange: (value: string) => void;
  onOpenPath: (path: string) => void;
  onHome: () => void;
  onParent: () => void;
  onRefresh: () => void;
  onSelectionChange: (selection: FileSelection) => void;
  onActivate: (entry: FileEntry) => void;
}

export function FtpPane({ tab, active }: Props) {
  const sessionId = tab.info.id;
  // The pane serves both FTP and SFTP file sessions; only the labels differ.
  const protocolLabel = tab.info.kind === "sftp" ? "SFTP" : "FTP";

  const [remoteHome, setRemoteHome] = useState("");
  const [remotePath, setRemotePath] = useState("");
  const [remoteDraft, setRemoteDraft] = useState("");
  const [remoteEntries, setRemoteEntries] = useState<FileEntry[]>([]);
  const [remoteSelection, setRemoteSelection] =
    useState<FileSelection>(EMPTY_SELECTION);
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [remoteError, setRemoteError] = useState<string | null>(null);

  const [localHome, setLocalHome] = useState("");
  const [localPath, setLocalPath] = useState("");
  const [localDraft, setLocalDraft] = useState("");
  const [localEntries, setLocalEntries] = useState<FileEntry[]>([]);
  const [localSelection, setLocalSelection] =
    useState<FileSelection>(EMPTY_SELECTION);
  const [localLoading, setLocalLoading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const localRequest = useRef(0);

  const [transferring, setTransferring] = useState(false);
  const [transfer, setTransfer] = useState<TransferState | null>(null);

  const loadRemote = useCallback(
    async (target: string) => {
      setRemoteLoading(true);
      setRemoteError(null);
      try {
        const listing = await api.sftpList(sessionId, target);
        setRemotePath(listing.path);
        setRemoteDraft(listing.path);
        setRemoteEntries(listing.entries);
        setRemoteSelection(EMPTY_SELECTION);
      } catch (error) {
        setRemoteError(friendlyFtpError(error));
      } finally {
        setRemoteLoading(false);
      }
    },
    [sessionId],
  );

  const loadLocal = useCallback(async (target: string) => {
    const request = ++localRequest.current;
    setLocalLoading(true);
    setLocalError(null);
    try {
      const listing = await api.localList(target);
      if (request !== localRequest.current) return;
      setLocalPath(listing.path);
      setLocalDraft(listing.path);
      setLocalEntries(listing.entries);
      setLocalSelection(EMPTY_SELECTION);
    } catch (error) {
      if (request !== localRequest.current) return;
      setLocalError(String(error));
    } finally {
      if (request === localRequest.current) setLocalLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab.state !== "connected") return;
    let cancelled = false;

    void (async () => {
      try {
        const [ftpHome, machineHome] = await Promise.all([
          api.sftpHome(sessionId),
          api.localHome(),
        ]);
        if (cancelled) return;
        setRemoteHome(ftpHome);
        setLocalHome(machineHome);
        await Promise.all([loadRemote(ftpHome), loadLocal(machineHome)]);
      } catch (error) {
        if (!cancelled) setRemoteError(friendlyFtpError(error));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loadLocal, loadRemote, sessionId, tab.state]);

  const selectedRemote = selectedEntries(remoteEntries, remoteSelection);
  const selectedLocal = selectedEntries(localEntries, localSelection);
  // Rename and delete act on exactly one entry; transfers take any number.
  const soleRemote = selectedRemote.length === 1 ? selectedRemote[0] : null;
  const soleLocal = selectedLocal.length === 1 ? selectedLocal[0] : null;

  const updateProgress = (progress: api.TransferProgress) => {
    setTransfer((current) =>
      current
        ? {
            ...current,
            transferred: progress.transferred,
            total: progress.total,
          }
        : current,
    );
  };

  /**
   * Copies the selected entries into the folder the other side shows, one
   * after another (issue #101). The batch is checked against that folder's
   * listing first: a clash with a link or with the other kind stops it before
   * anything is sent, and names already there are confirmed once for the
   * whole batch. A failure stops the rest; the reload shows what arrived.
   */
  const transferSelection = async (direction: "upload" | "download") => {
    const upload = direction === "upload";
    const items = upload ? selectedLocal : selectedRemote;
    const destination = upload ? remotePath : localPath;
    if (items.length === 0 || !destination || transferring) return;

    const side = upload ? "remote" : "local";
    const setError = upload ? setRemoteError : setLocalError;
    const collisions = batchCollisions(
      items,
      upload ? remoteEntries : localEntries,
      side,
      // APFS and NTFS match local names case-insensitively by default.
      !upload && (IS_MAC || IS_WINDOWS),
    );
    if (collisions.blocked) {
      setError(collisions.blocked);
      return;
    }
    if (collisions.existing.length > 0) {
      const prompt = replacePrompt(collisions.existing, side);
      const confirmed = await ask(prompt.message, {
        title: upload ? t("Upload") : t("Download"),
        kind: "warning",
        okLabel: prompt.okLabel,
        cancelLabel: "Cancel",
      });
      if (!confirmed) return;
    }

    setError(null);
    setTransferring(true);
    try {
      for (const [index, item] of items.entries()) {
        setTransfer({
          direction,
          name: batchItemName(item.name, index, items.length),
          transferred: 0,
          total: item.isDir ? 0 : item.size,
          status: "running",
        });
        if (upload) {
          const target = joinRemote(destination, item.name);
          if (item.isDir) {
            await api.sftpUploadDirectory(
              sessionId,
              item.path,
              target,
              updateProgress,
            );
          } else {
            await api.sftpUpload(sessionId, item.path, target, updateProgress);
          }
        } else {
          const target = joinLocal(destination, item.name);
          if (item.isDir) {
            await api.sftpDownloadDirectory(
              sessionId,
              item.path,
              target,
              updateProgress,
            );
          } else {
            await api.sftpDownload(
              sessionId,
              item.path,
              target,
              updateProgress,
            );
          }
        }
      }
      setTransfer((current) =>
        current ? { ...current, status: "complete" } : current,
      );
    } catch (error) {
      setTransfer((current) =>
        current
          ? { ...current, status: "error", message: String(error) }
          : current,
      );
    } finally {
      setTransferring(false);
    }
    await (upload ? loadRemote(destination) : loadLocal(destination));
  };

  const createRemoteFolder = async () => {
    if (!remotePath || transferring) return;
    const name = window.prompt(t("New remote folder name"))?.trim();
    if (!name) return;
    setRemoteError(null);
    try {
      await api.sftpMkdir(sessionId, joinRemote(remotePath, name));
      await loadRemote(remotePath);
    } catch (error) {
      setRemoteError(friendlyFtpError(error));
    }
  };

  const renameRemote = async () => {
    if (!soleRemote || transferring) return;
    const name = window.prompt(t("Rename remote item"), soleRemote.name)?.trim();
    if (!name || name === soleRemote.name) return;
    setRemoteError(null);
    try {
      await api.sftpRename(
        sessionId,
        soleRemote.path,
        joinRemote(remotePath, name),
      );
      await loadRemote(remotePath);
    } catch (error) {
      setRemoteError(friendlyFtpError(error));
    }
  };

  const removeRemote = async () => {
    if (!soleRemote || transferring) return;
    if (!(await confirmDelete(`Delete remote ${soleRemote.name}?`))) return;
    setRemoteError(null);
    try {
      await api.sftpRemove(
        sessionId,
        soleRemote.path,
        soleRemote.isDir,
      );
      await loadRemote(remotePath);
    } catch (error) {
      setRemoteError(friendlyFtpError(error));
    }
  };

  const createLocalFolder = async () => {
    if (!localPath || transferring) return;
    const name = window.prompt(t("New local folder name"))?.trim();
    if (!name) return;
    setLocalError(null);
    try {
      await api.localMkdir(joinLocal(localPath, name));
      await loadLocal(localPath);
    } catch (error) {
      setLocalError(String(error));
    }
  };

  const renameLocal = async () => {
    if (!soleLocal || transferring) return;
    const name = window.prompt(t("Rename local item"), soleLocal.name)?.trim();
    if (!name || name === soleLocal.name) return;
    setLocalError(null);
    try {
      await api.localRename(
        soleLocal.path,
        joinLocal(localPath, name),
      );
      await loadLocal(localPath);
    } catch (error) {
      setLocalError(String(error));
    }
  };

  const removeLocal = async () => {
    if (!soleLocal || transferring) return;
    const type = soleLocal.isDir ? "empty local folder" : "local file";
    if (!(await confirmDelete(`Delete ${type} “${soleLocal.name}”?`))) return;
    setLocalError(null);
    try {
      await api.localRemove(
        soleLocal.path,
        soleLocal.isDir,
      );
      await loadLocal(localPath);
    } catch (error) {
      setLocalError(String(error));
    }
  };

  const transferPercent = transfer
    ? transfer.status === "complete"
      ? 100
      : transfer.total > 0
        ? Math.min(100, (transfer.transferred / transfer.total) * 100)
        : null
    : null;

  return (
    <div className={`ftp-workspace${active ? "" : " is-hidden"}`}>
      {tab.state !== "connected" ? (
        <div className={`ftp-session-state is-${tab.state}`}>
          <strong>
            {tab.state === "connecting"
              ? t("Connecting to {0}…", { 0: protocolLabel })
              : t("{0} unavailable", { 0: protocolLabel })}
          </strong>
          <span>{tab.message ?? tab.info.address}</span>
        </div>
      ) : (
        <>
          <div className="ftp-dual-pane">
            <FileBrowser
              title={t("{0} Server", { 0: protocolLabel })}
              subtitle={tab.info.address}
              path={remotePath}
              draft={remoteDraft}
              entries={remoteEntries}
              selection={remoteSelection}
              loading={remoteLoading}
              error={remoteError}
              onDraftChange={setRemoteDraft}
              onOpenPath={(path) => void loadRemote(path)}
              onHome={() => void loadRemote(remoteHome)}
              onParent={() => void loadRemote(remoteParent(remotePath))}
              onRefresh={() => void loadRemote(remotePath || remoteHome)}
              onSelectionChange={setRemoteSelection}
              keyboardDisabled={transferring || !active}
              keyboardActions={{
                F2: soleRemote ? () => { void renameRemote(); } : undefined,
                Delete: soleRemote ? () => { void removeRemote(); } : undefined,
                "Mod+Shift+n": () => { void createRemoteFolder(); },
                F3: selectedRemote.length ? () => { void transferSelection("download"); } : undefined,
                F4: selectedLocal.length ? () => { void transferSelection("upload"); } : undefined,
              }}
              onActivate={(entry) => {
                if (entry.isDir) void loadRemote(entry.path);
              }}
              actions={
                <>
                  <ToolButton
                    label={t("New remote folder")}
                    onClick={() => void createRemoteFolder()}
                    disabled={remoteLoading || transferring}
                  >
                    <Icon name="new-folder" />
                  </ToolButton>
                  <ToolButton
                    label={t("Rename remote item")}
                    onClick={() => void renameRemote()}
                    disabled={!soleRemote || remoteLoading || transferring}
                  >
                    <Icon name="edit" />
                  </ToolButton>
                  <ToolButton
                    label={t("Delete remote item")}
                    onClick={() => void removeRemote()}
                    disabled={!soleRemote || remoteLoading || transferring}
                    danger
                  >
                    <Icon name="trash" />
                  </ToolButton>
                </>
              }
            />

            <div className="ftp-transfer-rail" aria-label={t("File transfer actions")}>
              <button
                className="ftp-transfer-button"
                onClick={() => void transferSelection("upload")}
                disabled={selectedLocal.length === 0 || transferring}
                title={
                  selectedLocal.length > 1
                    ? t("Upload {0} selected local items", { 0: selectedLocal.length })
                    : t("Upload selected local file or folder")
                }
              >
                <span>←</span>{t("Upload")}</button>
              <button
                className="ftp-transfer-button"
                onClick={() => void transferSelection("download")}
                disabled={selectedRemote.length === 0 || transferring}
                title={
                  selectedRemote.length > 1
                    ? t("Download {0} selected {1} items", { 0: selectedRemote.length, 1: protocolLabel })
                    : t("Download selected {0} file or folder", { 0: protocolLabel })
                }
              >{t("Download")}<span>→</span>
              </button>
            </div>

            <FileBrowser
              title={t("Local Computer")}
              subtitle="This device"
              path={localPath}
              draft={localDraft}
              entries={localEntries}
              selection={localSelection}
              loading={localLoading}
              error={localError}
              onDraftChange={setLocalDraft}
              onOpenPath={(path) => void loadLocal(path)}
              onHome={() => void loadLocal(localHome)}
              onParent={() => {
                void api.localParent(localPath).then(loadLocal);
              }}
              onRefresh={() => void loadLocal(localPath || localHome)}
              onSelectionChange={setLocalSelection}
              keyboardDisabled={transferring || !active}
              keyboardActions={{
                F2: soleLocal ? () => { void renameLocal(); } : undefined,
                Delete: soleLocal ? () => { void removeLocal(); } : undefined,
                "Mod+Shift+n": () => { void createLocalFolder(); },
                F3: selectedRemote.length ? () => { void transferSelection("download"); } : undefined,
                F4: selectedLocal.length ? () => { void transferSelection("upload"); } : undefined,
              }}
              onActivate={(entry) => {
                if (entry.isDir) void loadLocal(entry.path);
              }}
              actions={
                <>
                  <ToolButton
                    label={t("New local folder")}
                    onClick={() => void createLocalFolder()}
                    disabled={localLoading || transferring}
                  >
                    <Icon name="new-folder" />
                  </ToolButton>
                  <ToolButton
                    label={t("Rename local item")}
                    onClick={() => void renameLocal()}
                    disabled={!soleLocal || localLoading || transferring}
                  >
                    <Icon name="edit" />
                  </ToolButton>
                  <ToolButton
                    label={t("Delete local item")}
                    onClick={() => void removeLocal()}
                    disabled={!soleLocal || localLoading || transferring}
                    danger
                  >
                    <Icon name="trash" />
                  </ToolButton>
                </>
              }
            />
          </div>

          <div className={`ftp-transfer-status${transfer ? " has-transfer" : ""}`}>
            {transfer ? (
              <>
                <div className="ftp-transfer-summary">
                  <span>
                    {transfer.status === "complete"
                      ? t("Complete")
                      : transfer.status === "error"
                        ? t("Failed")
                        : transfer.direction === "upload"
                          ? t("Uploading")
                          : t("Downloading")}
                    : {transfer.name}
                  </span>
                  <span>
                    {formatBytes(transfer.transferred)}
                    {transfer.total > 0 ? ` / ${formatBytes(transfer.total)}` : ""}
                  </span>
                </div>
                <div className="ftp-transfer-progress">
                  <span
                    className={transferPercent === null ? "is-indeterminate" : ""}
                    style={
                      transferPercent === null
                        ? undefined
                        : { width: `${transferPercent}%` }
                    }
                  />
                </div>
                {transfer.message && (
                  <div className="ftp-transfer-error">{transfer.message}</div>
                )}
              </>
            ) : (
              <span>{t("Select local items to upload or {0} items to download; {1}-click or Shift-click selects several.", { 0: protocolLabel, 1: IS_MAC ? "⌘" : "Ctrl" })}</span>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function FileBrowser({
  title,
  subtitle,
  path,
  draft,
  entries,
  selection,
  loading,
  error,
  actions,
  keyboardActions,
  keyboardDisabled,
  onDraftChange,
  onOpenPath,
  onHome,
  onParent,
  onRefresh,
  onSelectionChange,
  onActivate,
}: FileBrowserProps) {
  const theme = useStore((s) => s.theme);
  const listRef = useRef<HTMLDivElement>(null);
  const addressRef = useRef<HTMLInputElement>(null);
  const order = entries.map((entry) => entry.path);
  return (
    <section className="ftp-file-browser">
      <div className="ftp-browser-header">
        <div>
          <strong>{title}</strong>
          <span>{subtitle}</span>
        </div>
        <div className="ftp-browser-actions">
          <ToolButton label="Home" onClick={onHome} disabled={loading}>
            <Icon name="home" />
          </ToolButton>
          <ToolButton label={t("Parent folder")} onClick={onParent} disabled={loading || !path}>
            <Icon name="arrow-up" />
          </ToolButton>
          <ToolButton label={t("Refresh")} onClick={onRefresh} disabled={loading}>
            <Icon name="refresh" />
          </ToolButton>
          {actions}
        </div>
      </div>

      <div className="ftp-browser-path">
        <input
          ref={addressRef}
          value={draft}
          aria-label={t("{0} path", { 0: title })}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") onOpenPath(draft);
            if (event.key === "Escape") onDraftChange(path);
          }}
        />
      </div>

      <div className="ftp-browser-columns">
        <span>{t("Name")}</span>
        <span>{t("Size")}</span>
        <span>{t("Modified")}</span>
      </div>

      <div
        ref={listRef}
        tabIndex={0}
        className="ftp-browser-list"
        role="listbox"
        aria-label={t("{0} files", { 0: title })}
        onMouseDown={(event) => { if (event.button === 0) listRef.current?.focus(); }}
        onKeyDown={(event) => {
          const key = panelKey(event);
          if (!key || loading || keyboardDisabled) return;
          let action = keyboardActions?.[key];
          if (path === api.LOCAL_DRIVES_ROOT && ["F2", "Delete", "Mod+Shift+n"].includes(key)) action = undefined;
          const picked = selectedEntries(entries, selection);
          const entry = picked.length === 1 ? picked[0] : undefined;
          if (key === "Enter" && entry) action = () => onActivate(entry);
          if (key === "Backspace" && path && path !== api.LOCAL_DRIVES_ROOT) action = onParent;
          if (key === "F5") action = onRefresh;
          if (key === "Alt+d") action = () => { addressRef.current?.focus(); addressRef.current?.select(); };
          const navigating = ["ArrowUp", "ArrowDown", "Home", "End"].includes(key);
          if (navigating) action = () => {
            const current = entries.findIndex((item) => item.path === selection.anchor);
            const index = key === "Home" ? 0 : key === "End" ? entries.length - 1
              : current < 0 ? (key === "ArrowUp" ? entries.length - 1 : 0)
              : Math.max(0, Math.min(entries.length - 1, current + (key === "ArrowUp" ? -1 : 1)));
            if (entries[index]) {
              onSelectionChange(selectEntry(selection, order, entries[index].path, "replace"));
              listRef.current?.querySelectorAll<HTMLElement>(".ftp-file-row")[index]?.scrollIntoView({ block: "nearest" });
            }
          };
          if (action) {
            consumePanelKey(event);
            if (!event.repeat || navigating) action();
          }
        }}
        aria-multiselectable
      >
        {error && <div className="ftp-browser-message is-error">{error}</div>}
        {!error && loading && <div className="ftp-browser-message">{t("Loading…")}</div>}
        {!error && !loading && entries.length === 0 && (
          <div className="ftp-browser-message">{t("This folder is empty.")}</div>
        )}
        {!error &&
          entries.map((entry) => {
            const selected = selection.paths.includes(entry.path);
            return (
              <div
                key={entry.path}
                className={`ftp-file-row${selected ? " is-selected" : ""}${entry.isDir ? " is-directory" : ""}`}
                role="option"
                aria-selected={selected}
                onClick={(event) => {
                  const mode = clickMode(event, IS_MAC);
                  if (mode) {
                    onSelectionChange(
                      selectEntry(selection, order, entry.path, mode),
                    );
                  }
                }}
                onDoubleClick={() => onActivate(entry)}
                title={entry.path}
              >
                <span className="ftp-file-name">
                  <span className="ftp-file-icon" aria-hidden="true">
                    <FileIcon name={entry.name} isDir={entry.isDir} theme={theme} />
                  </span>
                  <span>{entry.name}</span>
                </span>
                <span>{entry.isDir ? "—" : formatBytes(entry.size)}</span>
                <span>{formatDate(entry.modified)}</span>
              </div>
            );
          })}
      </div>
      <div className="ftp-browser-footer">
        <span>
          {entries.length}{t(" items")}{selection.paths.length > 1 && ` · ${selection.paths.length} selected`}
        </span>
        <span>{loading ? t("Loading…") : path}</span>
      </div>
    </section>
  );
}

function ToolButton({
  label,
  children,
  onClick,
  disabled,
  danger = false,
}: {
  label: string;
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      className={`ftp-tool-button${danger ? " is-danger" : ""}`}
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

/**
 * Asks before a delete. Not `window.confirm`: the dialog plugin replaces it
 * with an async function, so its result is a promise and always truthy.
 */
function confirmDelete(message: string): Promise<boolean> {
  return ask(message, {
    get title() { return t("Delete"); },
    kind: "warning",
    okLabel: "Delete",
    cancelLabel: "Cancel",
  });
}

function remoteParent(path: string): string {
  if (!path || path === "/") return "/";
  const trimmed = path.replace(/\/+$/, "");
  const slash = trimmed.lastIndexOf("/");
  return slash <= 0 ? "/" : trimmed.slice(0, slash);
}

function joinRemote(base: string, name: string): string {
  return base === "/" ? `/${name}` : `${base.replace(/\/+$/, "")}/${name}`;
}

function joinLocal(base: string, name: string): string {
  const separator = base.includes("\\") && !base.includes("/") ? "\\" : "/";
  return `${base.replace(/[\\/]+$/, "")}${separator}${name}`;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return bytes === 0 ? "0 B" : "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

function formatDate(seconds: number | null): string {
  if (seconds == null) return "—";
  return new Date(seconds * 1000).toLocaleString([], {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function friendlyFtpError(error: unknown): string {
  const message = String(error);
  if (message.includes("Response contains an invalid syntax")) {
    return "The FTP server returned a legacy or non-UTF-8 directory listing. Reconnect after updating EdgeTerm and try again.";
  }
  return message;
}
