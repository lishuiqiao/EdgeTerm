import * as api from "./api";
import { open as openDialog, save as saveDialog } from "./nativeDialog";
import { useStore } from "./store";
import type { BackupPreview } from "./types";

// Session → Export Data… / Import Data…: plain credential-free JSON by
// default, or a password-encrypted backup. Only the backend handles secrets.

/** Mirrors `APP_DATA_EXTENSION` in model.rs; the backend enforces it too. */
export const DATA_FILE_EXTENSION = "edgeterm";
const FILE_FILTERS = [
  { name: "EdgeTerm data", extensions: [DATA_FILE_EXTENSION] },
];

const hasDataExtension = (path: string) =>
  path.toLowerCase().endsWith(`.${DATA_FILE_EXTENSION}`);

/**
 * Not every platform's save dialog appends the filter's extension to a typed
 * name; the export must carry it or the import side will refuse the file.
 */
const withDataExtension = (path: string) =>
  hasDataExtension(path) ? path : `${path}.${DATA_FILE_EXTENSION}`;

const plural = (count: number, noun: string) =>
  `${count} ${noun}${count === 1 ? "" : "s"}`;

export const describeData = (counts: {
  profiles: number;
  groups: number;
  senderCommands: number;
}) =>
  [
    plural(counts.profiles, "session"),
    plural(counts.groups, "group"),
    plural(counts.senderCommands, "Sender command"),
  ].join(", ");

const basename = (path: string) => path.split(/[\\/]/).pop() || path;

const datestamp = (date: Date) =>
  [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");

export async function exportAppData(password: string | null = null): Promise<boolean> {
  const { exportSettings, setStatus } = useStore.getState();
  const now = new Date();
  const picked = await saveDialog({
    title: "Export EdgeTerm Data",
    defaultPath: `EdgeTerm-${datestamp(now)}.${DATA_FILE_EXTENSION}`,
    filters: FILE_FILTERS,
  });
  if (!picked) return false;
  const path = withDataExtension(picked);
  const summary = await api.exportAppData(
    path,
    exportSettings(),
    now.toISOString(),
    password,
  );
  setStatus(
    `Exported ${describeData(summary)} and settings to ${basename(path)} (${password === null ? "passwords are not included" : "encrypted, including saved passwords"})`,
  );
  return true;
}

export async function chooseDataImport(): Promise<string | null> {
  const store = useStore.getState();
  try {
    const picked = await openDialog({
      title: "Import EdgeTerm Data",
      multiple: false,
      directory: false,
      filters: FILE_FILTERS,
    });
    const path = typeof picked === "string" ? picked : null;
    if (!path) return null;
    // The dialog filter already narrows the list, but "All files" and typed
    // paths get through on some platforms; say what was expected up front.
    if (!hasDataExtension(path)) {
      store.setStatus(
        `Import failed: “${basename(path)}” is not an EdgeTerm data file (expected .${DATA_FILE_EXTENSION})`,
      );
      return null;
    }

    return path;
  } catch (error) {
    store.setStatus(`Import failed: ${error}`);
    return null;
  }
}

export async function importAppData(path: string, preview: BackupPreview, password: string | null): Promise<void> {
  const store = useStore.getState();
  const { summary: result, settings } = await api.importAppDataFile(path, preview.fingerprint, password);
  const hasSettings = !!settings && typeof settings === "object";
  if (hasSettings) store.applySettings(settings);
  await store.loadProfiles();
  store.bumpSenderLibrary();
  let status = `Imported ${describeData(result)}${hasSettings ? " and settings" : ""}${preview.encrypted ? " and saved credentials" : ""}`;
  if (result.skippedSenderCommands > 0) {
    status += `; skipped ${plural(result.skippedSenderCommands, "Sender command")} (library full)`;
  }
  store.setStatus(status);
}

/**
 * Session → Import OpenSSH Config…: picks a client configuration (the file
 * dialog starts at ~/.ssh/config), parses it and opens the chooser; the
 * import itself happens in `SshConfigImportDialog`.
 */
export async function importSshConfig(): Promise<void> {
  const store = useStore.getState();
  try {
    const defaultPath = await api.defaultSshConfigPath();
    const picked = await openDialog({
      title: "Import OpenSSH Config",
      multiple: false,
      directory: false,
      defaultPath,
    });
    const path = typeof picked === "string" ? picked : null;
    if (!path) return;
    const preview = await api.readSshConfig(path);
    if (preview.entries.length === 0) {
      store.setStatus(`No Host entries found in ${basename(path)}`);
      return;
    }
    store.setSshConfigImport(preview);
  } catch (error) {
    store.setStatus(`Import failed: ${error}`);
  }
}
