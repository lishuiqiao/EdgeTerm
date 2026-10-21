import { t } from "../../i18n";
import { ManualAiSuggestion, previewText, type AiPreview } from "../../aiSuggestion";
import { matchAppShortcut } from "../../shortcuts";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";

import * as api from "../../api";
import {
  clampRepeat,
  loadRepeatSettings,
  REPEAT_LIMITS,
  startSchedule,
  stopSchedule,
  storeRepeatSettings,
  useSchedule,
} from "../../senderSchedule";
import {
  loadSaveLevel,
  sameScope,
  scopeChain,
  scopeForLevel,
  scopeKey,
  scopeLabel,
  storeSaveLevel,
  type ScopeLevel,
} from "../../senderScope";
import { newStopSignal, sendUnits, type StopSignal } from "../../senderSend";
import {
  buildUnits,
  endingLabel,
  firstLine,
  type SendUnit,
} from "../../senderUnits";
import { byName } from "../../sessionGroups";
import { useStore } from "../../store";
import { getController } from "../../terminalRegistry";
import {
  isFileSession,
  type CommandScope,
  type LineEnding,
  type SavedCommand,
} from "../../types";
import { ContextMenu, type MenuItem } from "../ContextMenu";
import { Icon } from "../icons";

type Target = "current" | "all";
type CommandContextMenu = {
  commandId: string;
  x: number;
  y: number;
};
type CommandTooltip = {
  text: string;
  details: string;
  x: number;
  y: number;
};
/** What the inputs held before Edit replaced them, restored on Cancel. */
type Draft = {
  text: string;
  tagName: string;
  ending: LineEnding;
};
/** The scope picker hanging off the Save / Update button. */
type SavePicker = {
  x: number;
  y: number;
};
type Editing = {
  command: SavedCommand;
  draft: Draft;
};

const MAX_SAVED_COMMANDS = 1000;
const COMMANDS_PER_PAGE = 24;
const LINE_ENDINGS: [LineEnding, string][] = [
  ["none", "None"],
  ["lf", "LF (\\n)"],
  ["crlf", "CRLF (\\r\\n)"],
];

interface SenderPanelProps {
  compact: boolean;
  canCompact: boolean;
  onExpandedChange: (expanded: boolean) => void;
}

export function SenderPanel({ compact, canCompact, onExpandedChange }: SenderPanelProps) {
  const tabs = useStore((s) => s.tabs);
  const activeId = useStore((s) => s.activeId);
  const profiles = useStore((s) => s.profiles);
  const groups = useStore((s) => s.groups);
  const setStatus = useStore((s) => s.setStatus);
  const libraryVersion = useStore((s) => s.senderLibraryVersion);

  const [text, setText] = useState("");
  const aiEnabled = useStore(s => s.aiSuggestionsEnabled);
  const aiConfigVersion = useStore(s => s.aiConfigVersion);
  const connectionState = useStore(s => s.tabs.find(t => t.info.id === s.activeId)?.state);
  const [aiPreview, setAiPreview] = useState<AiPreview | null>(null);
  const ai = useMemo(() => new ManualAiSuggestion(setAiPreview, message => useStore.getState().setStatus(t("AI: {0}", { 0: message }))), []);
  useEffect(() => { ai.clear(); }, [ai, text, activeId, aiEnabled, aiConfigVersion, connectionState, compact]);
  useEffect(() => { window.addEventListener("blur", ai.clear); return () => { window.removeEventListener("blur", ai.clear); ai.clear(); }; }, [ai]);
  const [tagName, setTagName] = useState("");
  const [ending, setEnding] = useState<LineEnding>("lf");
  const [savedCommands, setSavedCommands] = useState<SavedCommand[]>([]);
  const [selectedCommandId, setSelectedCommandId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<CommandContextMenu | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [commandTooltip, setCommandTooltip] = useState<CommandTooltip | null>(null);
  const [page, setPage] = useState(1);
  const [target, setTarget] = useState<Target>("current");
  const [running, setRunning] = useState(false);
  const [commandsLoading, setCommandsLoading] = useState(true);
  const [libraryBusy, setLibraryBusy] = useState(false);
  // Save / Update open a picker for the scope; the last choice's level is
  // preselected in it.
  const [savePicker, setSavePicker] = useState<SavePicker | null>(null);
  const [moreAnchor, setMoreAnchor] = useState<{ left: number; bottom: number } | null>(null);
  const [moreQuery, setMoreQuery] = useState("");
  const [saveLevel, setSaveLevel] = useState<ScopeLevel>(loadSaveLevel);
  const saveButtonRef = useRef<HTMLButtonElement>(null);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const tooltipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Repeat: the strip under the compose row and its settings. The schedule
  // itself lives outside the panel (`senderSchedule.ts`), so hiding the
  // panel does not stop a keepalive; the strip shows and stops it.
  const [repeatOpen, setRepeatOpen] = useState(false);
  const [repeat, setRepeat] = useState(loadRepeatSettings);
  const schedule = useSchedule();
  const [now, setNow] = useState(() => Date.now());
  /** Abandons the send in progress between its lines. */
  const stopRef = useRef<StopSignal | null>(null);
  const commandRef = useRef<HTMLTextAreaElement>(null);

  // The countdown to the next scheduled send.
  useEffect(() => {
    if (!schedule) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [schedule]);

  // The command box grows with its lines, up to the stylesheet's max-height.
  useEffect(() => {
    const box = commandRef.current;
    if (!box) return;
    box.style.height = "auto";
    box.style.height = `${box.scrollHeight}px`;
  }, [text, compact]);

  // A manual send does not outlive the panel; a schedule does.
  useEffect(() => () => stopRef.current?.stop(), []);

  const closeMore = useCallback(() => setMoreAnchor(null), []);

  useEffect(() => {
    if (!compact) closeMore();
  }, [compact, closeMore]);

  // Loads the library on mount and again after it changed outside this
  // panel (a data import, a deleted profile or group); an edit in progress
  // would then update stale contents, so it is dropped.
  useEffect(() => {
    let cancelled = false;
    setCommandsLoading(true);
    void api
      .listSenderCommands()
      .then((commands) => {
        if (cancelled) return;
        setSavedCommands(commands);
        setEditing(null);
      })
      .catch((error) => {
        if (!cancelled) setStatus(t("Sender: failed to load saved commands: {0}", { 0: error }));
      })
      .finally(() => {
        if (!cancelled) setCommandsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [setStatus, libraryVersion]);

  useEffect(() => () => {
    if (tooltipTimer.current) clearTimeout(tooltipTimer.current);
  }, []);

  useEffect(() => {
    if (!moreAnchor) return;
    const closeOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!moreMenuRef.current?.contains(target) && !moreButtonRef.current?.contains(target)) {
        setMoreAnchor(null);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setMoreAnchor(null);
        moreButtonRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", closeOutside, true);
    window.addEventListener("keydown", closeOnEscape, true);
    window.addEventListener("resize", closeMore);
    return () => {
      document.removeEventListener("mousedown", closeOutside, true);
      window.removeEventListener("keydown", closeOnEscape, true);
      window.removeEventListener("resize", closeMore);
    };
  }, [moreAnchor, closeMore]);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);
  const closeSavePicker = useCallback(() => setSavePicker(null), []);

  const openComposer = () => {
    closeMore();
    onExpandedChange(true);
    requestAnimationFrame(() => commandRef.current?.focus());
  };

  const activeTab = tabs.find((tab) => tab.info.id === activeId);
  const chain = useMemo(
    () => scopeChain(activeTab, profiles, groups),
    [activeTab, profiles, groups],
  );
  const labelOf = (scope: CommandScope) => scopeLabel(scope, profiles, groups);

  // Commands the active tab sees, in one alphabetical list regardless of
  // scope; the tooltip names each tag's scope.
  const visibleCommands = useMemo(() => {
    const keys = new Set(chain.map(scopeKey));
    return savedCommands
      .filter((command) => keys.has(scopeKey(command.scope)))
      .sort(byName);
  }, [chain, savedCommands]);

  const pageCount = Math.max(
    1,
    Math.ceil(visibleCommands.length / COMMANDS_PER_PAGE),
  );
  // Switching tabs can shrink the list under the current page.
  const currentPage = Math.min(page, pageCount);
  const pageCommands = visibleCommands.slice(
    (currentPage - 1) * COMMANDS_PER_PAGE,
    currentPage * COMMANDS_PER_PAGE,
  );
  const moreMatches = moreAnchor
    ? visibleCommands.filter((command) =>
        `${command.name}\n${command.text}\n${labelOf(command.scope)}`
          .toLocaleLowerCase()
          .includes(moreQuery.toLocaleLowerCase().trim()),
      )
    : [];

  const hideCommandTooltip = () => {
    if (tooltipTimer.current) {
      clearTimeout(tooltipTimer.current);
      tooltipTimer.current = null;
    }
    setCommandTooltip(null);
  };

  const showCommandTooltip = (
    command: SavedCommand,
    element: HTMLElement,
  ) => {
    hideCommandTooltip();
    const rect = element.getBoundingClientRect();
    tooltipTimer.current = setTimeout(() => {
      setCommandTooltip({
        // The line ending is in the Edit view; the tooltip answers "what
        // does this send, and where is it listed".
        text: command.text,
        details: labelOf(command.scope),
        x: Math.max(8, Math.min(rect.left, window.innerWidth - 428)),
        y: rect.top - 8,
      });
      tooltipTimer.current = null;
    }, 200);
  };

  const targets = (): string[] => {
    if (target === "all") {
      return tabs
        .filter((tab) => !isFileSession(tab.info.kind))
        .map((tab) => tab.info.id);
    }
    return tabs.some(
      (tab) => tab.info.id === activeId && !isFileSession(tab.info.kind),
    ) && activeId
      ? [activeId]
      : [];
  };

  /**
   * Save and Update both go through the picker: it checks the input first
   * so an empty command is reported instead of asking where to file it.
   */
  const openSavePicker = () => {
    if (commandsLoading || libraryBusy) return;
    if (text.length === 0) {
      setStatus(
        editing
          ? t("Sender: enter a command before updating")
          : t("Sender: enter a command before saving"),
      );
      return;
    }
    if (!editing && savedCommands.length >= MAX_SAVED_COMMANDS) {
      setStatus(t("Sender: saved command limit is {0}", { 0: MAX_SAVED_COMMANDS }));
      return;
    }
    const rect = saveButtonRef.current?.getBoundingClientRect();
    if (!rect) return;
    setSavePicker({ x: rect.right, y: rect.bottom + 2 });
  };

  const pickSaveScope = (scope: CommandScope) => {
    setSaveLevel(scope.type);
    storeSaveLevel(scope.type);
    if (editing) void updateCommand(scope);
    else void saveCommand(scope);
  };

  const saveCommand = async (scope: CommandScope) => {
    if (commandsLoading || libraryBusy) return;
    if (text.length === 0) {
      setStatus(t("Sender: enter a command before saving"));
      return;
    }
    if (savedCommands.length >= MAX_SAVED_COMMANDS) {
      setStatus(t("Sender: saved command limit is {0}", { 0: MAX_SAVED_COMMANDS }));
      return;
    }

    const newCommand: SavedCommand = {
      id: "",
      name: tagName.trim() || firstLine(text),
      text,
      ending,
      scope,
    };
    const nextLength = savedCommands.length + 1;
    setLibraryBusy(true);
    try {
      const saved = await api.saveSenderCommand(newCommand);
      setSavedCommands((current) => [...current, saved]);
      setSelectedCommandId(saved.id);
      setTagName("");
      setStatus(
        t("Sender: saved command {0}/{1} ({2})", { 0: nextLength, 1: MAX_SAVED_COMMANDS, 2: labelOf(saved.scope) }),
      );
    } catch (error) {
      setStatus(t("Sender: failed to save command: {0}", { 0: error }));
    } finally {
      setLibraryBusy(false);
    }
  };

  const replaceSaved = (saved: SavedCommand) =>
    setSavedCommands((current) =>
      current.map((candidate) =>
        candidate.id === saved.id ? saved : candidate,
      ),
    );

  /** Saves `command` with `patch` applied, keeping an open edit in step. */
  const updateSaved = async (
    command: SavedCommand,
    patch: Partial<Pick<SavedCommand, "ending" | "scope">>,
  ) => {
    if (libraryBusy) return;
    setLibraryBusy(true);
    try {
      const saved = await api.saveSenderCommand({ ...command, ...patch });
      replaceSaved(saved);
      setEditing((current) =>
        current?.command.id === saved.id
          ? { ...current, command: saved }
          : current,
      );
      if (editing?.command.id === saved.id) setEnding(saved.ending);
    } catch (error) {
      setStatus(t("Sender: failed to update command: {0}", { 0: error }));
    } finally {
      setLibraryBusy(false);
    }
  };

  /** Loads a saved tag into the inputs; Save becomes Update until done. */
  const beginEdit = (command: SavedCommand) => {
    if (libraryBusy) return;
    if (compact) onExpandedChange(true);
    closeMore();
    // The first Edit remembers whatever was typed; switching tags mid-edit
    // keeps that original draft so Cancel still restores it.
    const draft = editing?.draft ?? { text, tagName, ending };
    setEditing({ command, draft });
    setSelectedCommandId(command.id);
    setText(command.text);
    setTagName(
      command.name === command.text || command.name === firstLine(command.text)
        ? ""
        : command.name,
    );
    setEnding(command.ending);
  };

  const cancelEdit = () => {
    if (!editing) return;
    const { draft } = editing;
    setEditing(null);
    setText(draft.text);
    setTagName(draft.tagName);
    setEnding(draft.ending);
  };

  const updateCommand = async (scope: CommandScope) => {
    if (!editing || libraryBusy) return;
    if (text.length === 0) {
      setStatus(t("Sender: enter a command before updating"));
      return;
    }
    setLibraryBusy(true);
    try {
      const saved = await api.saveSenderCommand({
        ...editing.command,
        name: tagName.trim() || firstLine(text),
        text,
        ending,
        scope,
      });
      replaceSaved(saved);
      setSelectedCommandId(saved.id);
      setEditing(null);
      setTagName("");
      setStatus(t("Sender: updated saved command ({0})", { 0: labelOf(saved.scope) }));
    } catch (error) {
      setStatus(t("Sender: failed to update command: {0}", { 0: error }));
    } finally {
      setLibraryBusy(false);
    }
  };

  const removeCommand = async (id: string) => {
    if (libraryBusy) return;
    setLibraryBusy(true);
    try {
      await api.deleteSenderCommand(id);
      setSavedCommands((current) =>
        current.filter((command) => command.id !== id),
      );
      if (selectedCommandId === id) setSelectedCommandId(null);
      if (contextMenu?.commandId === id) setContextMenu(null);
      if (editing?.command.id === id) cancelEdit();
    } catch (error) {
      setStatus(t("Sender: failed to delete command: {0}", { 0: error }));
    } finally {
      setLibraryBusy(false);
    }
  };

  const sendCommand = async (
    commandText: string,
    commandEnding: LineEnding,
  ) => {
    if (running) return;
    const targetIds = targets();
    if (targetIds.length === 0) {
      setStatus(t("Sender: no session selected"));
      return;
    }

    const units: SendUnit[] = buildUnits(commandText, commandEnding);
    if (units.length === 0) return;

    const stop = newStopSignal();
    stopRef.current = stop;
    setRunning(true);
    try {
      const { sent, skipped } = await sendUnits(
        targetIds,
        units,
        commandEnding,
        stop,
      );
      if (sent.length === 0) {
        setStatus(
          t("Sender: blocked while a file transfer or another send is running"),
        );
      } else if (stop.stopped) {
        setStatus(t("Sender: stopped"));
      } else {
        const what =
          units.length > 1 ? `sent ${units.length} lines` : "sent command";
        setStatus(
          skipped.length === 0
            ? t("Sender: {0}", { 0: what })
            : t("Sender: {0}; skipped {1} session(s) with a file transfer or another send running", { 0: what, 1: skipped.length }),
        );
      }
    } catch (e) {
      setStatus(t("Sender: {0}", { 0: e }));
    } finally {
      stopRef.current = null;
      setRunning(false);
    }
  };

  const stopSending = () => stopRef.current?.stop();

  /** Starts repeating a command with the strip's interval and count. */
  const beginRepeat = (commandText: string, commandEnding: LineEnding) => {
    const settings = clampRepeat(repeat);
    setRepeat(settings);
    storeRepeatSettings(settings);
    const sessionId =
      target === "current" && activeTab && !isFileSession(activeTab.info.kind)
        ? activeTab.info.id
        : null;
    const problem = startSchedule({
      text: commandText,
      ending: commandEnding,
      target,
      sessionId,
      every: settings.every,
      times: settings.times,
    });
    if (problem) {
      setStatus(t("Sender: {0}", { 0: problem }));
      return;
    }
    setRepeatOpen(true);
  };

  const onSenderKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    if (event.target === commandRef.current && matchAppShortcut(event)?.kind === "aiSuggest") return;
    if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (document.querySelector(".dialog-backdrop, [aria-modal='true'], [role='menu']")) return;
    const key = /^Key[A-Z]$/.test(event.code) ? event.code.slice(3).toLowerCase() : event.key.toLowerCase();
    if (!["enter", "q", "x"].includes(key)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.repeat) return;
    if (key === "enter") void sendCommand(text, ending);
    else if (key === "q") { stopSending(); if (schedule) stopSchedule(); }
    else setText("");
  };

  const emptyMessage = commandsLoading
    ? t("Loading saved commands…")
    : savedCommands.length === 0
      ? t("Save a command to add it here.")
      : "No saved commands apply to this session; they are listed under the sessions, groups or kinds they were saved to.";

  return (
    <div style={{ display: "contents" }} onKeyDownCapture={onSenderKeyDown}>
      {compact ? (
        <div className="panel-header sender-quickbar">
          <div className="panel-title is-sender sender-quick-title">
            <Icon name="send" />{t("Sender")}</div>
          <div
            className="sender-quick-tags"
            aria-label={t("Saved commands")}
            onWheel={(event) => {
              if (event.currentTarget.scrollWidth > event.currentTarget.clientWidth) {
                event.currentTarget.scrollLeft += event.deltaY;
              }
            }}
          >
            {visibleCommands.length === 0 ? (
              <span className="sender-quick-empty">{emptyMessage}</span>
            ) : visibleCommands.map((command) => (
              <div className="sender-command-tag sender-quick-tag" key={command.id}>
                <button
                  type="button"
                  className="sender-command-load"
                  data-own-tooltip
                  aria-label={t("Send {0}: {1}", { 0: command.name, 1: command.text })}
                  disabled={running}
                  onMouseEnter={(event) => showCommandTooltip(command, event.currentTarget)}
                  onMouseLeave={hideCommandTooltip}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    setSelectedCommandId(command.id);
                    void sendCommand(command.text, command.ending);
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    hideCommandTooltip();
                    setContextMenu({ commandId: command.id, x: event.clientX, y: event.clientY });
                  }}
                >
                  <Icon name="run-compact" />
                  <span>{command.name}</span>
                </button>
                <button
                  type="button"
                  className="sender-quick-options"
                  aria-label={t("Options for {0}", { 0: command.name })}
                  title={t("Options for {0}", { 0: command.name })}
                  onClick={(event) => {
                    hideCommandTooltip();
                    const rect = event.currentTarget.getBoundingClientRect();
                    setContextMenu({ commandId: command.id, x: rect.right, y: rect.top });
                  }}
                >
                  <Icon name="ellipsis" />
                </button>
              </div>
            ))}
          </div>
          <button
            ref={moreButtonRef}
            type="button"
            className="sender-quick-button"
            aria-expanded={moreAnchor !== null}
            onClick={() => {
              if (moreAnchor) return closeMore();
              hideCommandTooltip();
              const rect = moreButtonRef.current?.getBoundingClientRect();
              if (!rect) return;
              setMoreQuery("");
              setMoreAnchor({
                left: Math.max(8, Math.min(rect.left, window.innerWidth - 348)),
                bottom: window.innerHeight - rect.top + 4,
              });
            }}
          >{t("More ")}<span className="sender-quick-count">{visibleCommands.length}</span>
            <Icon name="chevron-down" />
          </button>
          {running && (
            <button
              type="button"
              className="sender-quick-button is-stop"
              title={t("Stop after the current line")}
              onClick={stopSending}
            >
              <Icon name="debug-stop" />{t("Stop sending")}</button>
          )}
          {schedule && (
            <button
              type="button"
              className="sender-quick-button is-running"
              title={t("Repeating {0} · click to stop", { 0: firstLine(schedule.spec.text) })}
              onClick={stopSchedule}
            >
              <Icon name="watch" />{t("Stop repeat")}</button>
          )}
          <label className="sender-quick-target select-wrap">
            <select
              className="select"
              value={target}
              aria-label={t("Sender targets")}
              onChange={(event) => setTarget(event.target.value as Target)}
            >
              <option value="current">{t("Current Session")}</option>
              <option value="all">{t("All Sessions (")}{tabs.length})</option>
            </select>
            <Icon name="chevron-down" className="select-chevron" />
          </label>
          <button type="button" className="sender-quick-button is-primary" onClick={openComposer}>
            <Icon name="add" />
            {editing ? t("Continue editing") : t("New")}
          </button>
          <button
            type="button"
            className="sender-quick-button is-icon"
            title={t("Expand Sender")}
            aria-label={t("Expand Sender")}
            onClick={openComposer}
          >
            <Icon name="arrow-up" />
          </button>
        </div>
      ) : (
      <>
      <div className="panel-header sender-header">
        <div className="panel-title is-sender">
          <Icon name="send" />{t("Sender")}</div>
        <div className="sender-options">
          <label className="sender-field">
            <span>{t("Ending")}</span>
            <span className="select-wrap">
              <select
                className="select"
                value={ending}
                onChange={(event) =>
                  setEnding(event.target.value as LineEnding)
                }
              >
                <option value="none">{t("None")}</option>
                <option value="lf">{"LF (\\n)"}</option>
                <option value="crlf">{"CRLF (\\r\\n)"}</option>
              </select>
              <Icon name="chevron-down" className="select-chevron" />
            </span>
          </label>

          <label className="sender-field">
            <span>{t("Targets")}</span>
            <span className="select-wrap">
              <select
                className="select"
                value={target}
                onChange={(event) => setTarget(event.target.value as Target)}
              >
                <option value="current">{t("Current Session")}</option>
                <option value="all">{t("All Sessions (")}{tabs.length})</option>
              </select>
              <Icon name="chevron-down" className="select-chevron" />
            </span>
          </label>
        </div>
        {canCompact && (
          <button
            type="button"
            className="sender-collapse"
            title={t("Show saved commands in one row")}
            aria-label={t("Collapse Sender")}
            onClick={() => {
              closeSavePicker();
              onExpandedChange(false);
            }}
          >
            <Icon name="arrow-down" />
          </button>
        )}
      </div>

      <div className="sender-compose">
        <div className="sender-command">
          <textarea
            ref={commandRef}
            className="sender-command-input"
            rows={1}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={text}
            placeholder={t("Type a command ({0}); Shift+Enter adds a line", { 0: endingLabel(ending) })}
            onChange={(event) => {
              ai.clear();
              if (!editing) setSelectedCommandId(null);
              setText(event.target.value);
            }}
            onCompositionStart={() => ai.clear()}
            onBlur={() => ai.clear()}
            onSelect={() => {
              const box = commandRef.current;
              if (box && (box.selectionStart !== box.value.length || box.selectionEnd !== box.value.length)) ai.clear();
            }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) { ai.clear(); return; }
              if (document.querySelector(".dialog-backdrop, [aria-modal='true']")) return;
              if (matchAppShortcut(event)?.kind === "aiSuggest") {
                event.preventDefault(); event.stopPropagation();
                if (!event.repeat) {
                  const box = event.currentTarget;
                  if (!aiEnabled) setStatus("Enable AI Command Suggestions first.");
                  else if (!text.trim()) setStatus("Enter a request or partial command first.");
                  else if (box.selectionStart !== text.length || box.selectionEnd !== text.length) setStatus("Move the cursor to the end of the input first.");
                  else void ai.generate(text, activeTab?.info.kind === "local" ? (profiles.find(p => p.id === activeTab.info.profileId)?.shell?.split(/[\\/]/).pop() || "unknown local shell") : "unknown remote shell");
                }
                return;
              }
              if (event.key === "Tab" && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey && ai.value?.command) {
                event.preventDefault(); event.stopPropagation();
                const command = ai.take(text);
                if (command !== null) { setText(command); requestAnimationFrame(() => commandRef.current?.setSelectionRange(command.length, command.length)); }
                return;
              }
              if (event.key === "Escape" && ai.value) { event.preventDefault(); event.stopPropagation(); ai.clear(); return; }
              if (!["Shift", "Control", "Alt", "Meta"].includes(event.key)) ai.clear();
              // Enter runs, Shift+Enter adds a line. An Enter that ends an
              // IME composition belongs to the input method.
              if (event.key === "Enter" && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey) {
                if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || event.repeat) return;
                event.preventDefault();
                void sendCommand(text, ending);
              } else if (event.key === "Escape" && editing) {
                event.preventDefault();
                cancelEdit();
              }
            }}
          />
          {aiPreview && (
            <div className="sender-ai-preview ai-ghost ai-preview-scroll"
              role="region" aria-label={t("AI command suggestion")}
              onMouseDown={event => event.preventDefault()}
              onWheel={event => event.stopPropagation()}>
              {previewText({ ...aiPreview, input: "" })}
            </div>
          )}
          {text.length > 0 && (
            <button
              type="button"
              className="sender-clear"
              onClick={() => setText("")}
              title={t("Clear")}
              aria-label={t("Clear command")}
            >
              <Icon name="close" />
            </button>
          )}
        </div>
        {running ? (
          <button
            type="button"
            className="sender-send is-stop"
            onClick={stopSending}
            title={t("Stop after the current line")}
            aria-label={t("Stop sending")}
          >
            <Icon name="debug-stop" />
          </button>
        ) : (
          <button
            type="button"
            className="sender-send"
            onClick={() => void sendCommand(text, ending)}
            title={t("Run command (Enter)")}
            aria-label={t("Run command")}
          >
            <Icon name="run-compact" />
          </button>
        )}
        <button
          type="button"
          className={[
            "sender-repeat-toggle",
            schedule ? "is-running" : repeatOpen ? "is-active" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          onClick={() => setRepeatOpen((open) => !open)}
          title={
            schedule ? t("A command is repeating on a timer") : t("Repeat on a timer")
          }
          aria-label={t("Repeat on a timer")}
          aria-pressed={repeatOpen || schedule !== null}
        >
          <Icon name="watch" />
        </button>
        <div className="sender-compose-divider" aria-hidden="true" />
        <input
          className="sender-label-input"
          type="text"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          maxLength={80}
          value={tagName}
          placeholder={t("Tag name (optional)")}
          aria-label={t("Saved command tag name")}
          onChange={(event) =>
            setTagName(event.target.value.replace(/[\r\n]+/g, ""))
          }
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              openSavePicker();
            } else if (event.key === "Escape" && editing) {
              event.preventDefault();
              cancelEdit();
            }
          }}
        />
        {editing ? (
          <>
            <button
              className="sender-save-btn"
              type="button"
              ref={saveButtonRef}
              disabled={libraryBusy || text.length === 0}
              title={t("Update \"{0}\" — asks where to list it", { 0: editing.command.name })}
              aria-haspopup="menu"
              aria-expanded={savePicker !== null}
              onClick={openSavePicker}
            >{t("Update")}</button>
            <button
              className="sender-save-btn is-secondary"
              type="button"
              disabled={libraryBusy}
              onClick={cancelEdit}
            >{t("Cancel")}</button>
          </>
        ) : (
          <button
            className="sender-save-btn"
            type="button"
            ref={saveButtonRef}
            disabled={
              commandsLoading ||
              libraryBusy ||
              text.length === 0 ||
              savedCommands.length >= MAX_SAVED_COMMANDS
            }
            title={t("Save the command — asks where to list it")}
            aria-haspopup="menu"
            aria-expanded={savePicker !== null}
            onClick={openSavePicker}
          >{t("Save")}</button>
        )}
      </div>

      {(repeatOpen || schedule) && (
        <div
          className={`sender-repeat${schedule ? " is-running" : ""}`}
          role="group"
          aria-label={t("Repeat")}
        >
          <Icon name="watch" />
          {schedule ? (
            <>
              <span className="sender-repeat-text">{t("Repeating ")}<code>{firstLine(schedule.spec.text)}</code>{t(" every")}{" "}
                {describeEvery(schedule.spec.every)}
                {" · "}
                {schedule.spec.target === "all"
                  ? t("all sessions")
                  : t("one session")}
                {" · "}{t("sent ")}{schedule.sent}
                {schedule.spec.times > 0 ? t(" of {0}", { 0: schedule.spec.times }) : ""}
                {schedule.nextAt !== null
                  ? t(" · next in {0} s", { 0: Math.max(0, Math.ceil((schedule.nextAt - now) / 1000)) })
                  : t(" · sending…")}
              </span>
              <button
                type="button"
                className="sender-save-btn"
                onClick={stopSchedule}
              >{t("Stop")}</button>
            </>
          ) : (
            <>
              <label className="sender-field">
                <span>{t("Every")}</span>
                <input
                  className="sender-repeat-number"
                  type="number"
                  min={REPEAT_LIMITS.minEvery}
                  max={REPEAT_LIMITS.maxEvery}
                  value={repeat.every}
                  aria-label={t("Seconds between sends")}
                  onChange={(event) =>
                    setRepeat({ ...repeat, every: Number(event.target.value) })
                  }
                />
                <span>{t("s")}</span>
              </label>
              <label className="sender-field">
                <span>{t("Times")}</span>
                <input
                  className="sender-repeat-number"
                  type="number"
                  min={0}
                  max={REPEAT_LIMITS.maxTimes}
                  value={repeat.times}
                  aria-label={t("Number of sends, 0 for until stopped")}
                  onChange={(event) =>
                    setRepeat({ ...repeat, times: Number(event.target.value) })
                  }
                />
                <span>{t("0 = until stopped")}</span>
              </label>
              <span className="sender-repeat-hint">{t("Sends the command to the chosen targets on a timer, e.g. to keep a session alive.")}</span>
              <button
                type="button"
                className="sender-save-btn"
                disabled={text.length === 0}
                onClick={() => beginRepeat(text, ending)}
              >{t("Start")}</button>
            </>
          )}
        </div>
      )}

      {savePicker && (() => {
        // Broadest first, like every scope list. The check marks the current
        // scope of the tag being edited, or the level picked last time.
        const preselected = editing
          ? editing.command.scope
          : scopeForLevel(chain, saveLevel);
        const items: MenuItem[] = [
          { heading: editing ? t("Update and list under") : t("Save and list under") },
          ...chain.map((scope) => ({
            label: labelOf(scope),
            checked: sameScope(scope, preselected),
            mark: "radio" as const,
            action: () => pickSaveScope(scope),
          })),
        ];
        return (
          <ContextMenu
            x={savePicker.x}
            y={savePicker.y}
            align="right"
            items={items}
            onClose={closeSavePicker}
          />
        );
      })()}

      <div className="sender-library">
        {pageCount > 1 && (
          <div className="sender-library-head">
            <span>{visibleCommands.length}{t(" saved commands")}</span>
            <div className="sender-pagination">
              <button
                type="button"
                disabled={currentPage === 1}
                onClick={() => setPage(currentPage - 1)}
                title={t("Previous page")}
                aria-label={t("Previous page")}
              >
                <Icon name="chevron-left" />
              </button>
              <span>
                {currentPage} / {pageCount}
              </span>
              <button
                type="button"
                disabled={currentPage === pageCount}
                onClick={() => setPage(currentPage + 1)}
                title={t("Next page")}
                aria-label={t("Next page")}
              >
                <Icon name="chevron-right" />
              </button>
            </div>
          </div>
        )}

        {pageCommands.length === 0 ? (
          <div className="sender-library-empty">{emptyMessage}</div>
        ) : (
          <div className="sender-command-tags">
            {pageCommands.map((command) => (
              <div
                className={[
                  "sender-command-tag",
                  selectedCommandId === command.id ? "is-selected" : "",
                  editing?.command.id === command.id ? "is-editing" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                key={command.id}
                onContextMenu={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  hideCommandTooltip();
                  setSelectedCommandId(command.id);
                  setContextMenu({
                    commandId: command.id,
                    x: event.clientX,
                    y: event.clientY,
                  });
                }}
              >
                <button
                  className="sender-command-load"
                  type="button"
                  data-own-tooltip
                  aria-label={t("Send {0}: {1}", { 0: command.name, 1: command.text })}
                  disabled={running}
                  onMouseEnter={(event) =>
                    showCommandTooltip(command, event.currentTarget)
                  }
                  onMouseLeave={hideCommandTooltip}
                  // A press here must not move the focus: the point of a
                  // saved command is to send it and keep typing in the
                  // session, and the default focus change would leave the
                  // keyboard on the button (or on the body, which is where
                  // WebKit puts it for a button) until the terminal is
                  // clicked again. Keyboard activation still focuses it.
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    setSelectedCommandId(command.id);
                    void sendCommand(command.text, command.ending);
                  }}
                >
                  {command.name}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      </>
      )}

      {moreAnchor && (
        <div
          ref={moreMenuRef}
          className="sender-more-menu"
          role="dialog"
          aria-label={t("Find saved command")}
          style={{ left: moreAnchor.left, bottom: moreAnchor.bottom }}
        >
          <div className="sender-more-search">
            <Icon name="search" />
            <input
              autoFocus
              type="search"
              value={moreQuery}
              placeholder={t("Find a saved command")}
              aria-label={t("Find a saved command")}
              onChange={(event) => setMoreQuery(event.target.value)}
            />
          </div>
          <div className="sender-more-list">
            {moreMatches.slice(0, 100).map((command) => (
              <button
                type="button"
                key={command.id}
                className="sender-more-item"
                disabled={running}
                onClick={() => {
                  closeMore();
                  setSelectedCommandId(command.id);
                  void sendCommand(command.text, command.ending);
                  if (activeId) getController(activeId)?.focus();
                }}
              >
                <Icon name="run-compact" />
                <span className="sender-more-name">{command.name}</span>
                <span className="sender-more-scope">{labelOf(command.scope)}</span>
              </button>
            ))}
            {moreMatches.length === 0 && <span className="sender-more-empty">{t("No matching commands")}</span>}
          </div>
          {moreMatches.length > 100 && (
            <div className="sender-more-foot">{t("Showing 100 of ")}{moreMatches.length}{t("; type to narrow")}</div>
          )}
        </div>
      )}

      {contextMenu && (() => {
        const command = savedCommands.find(
          (candidate) => candidate.id === contextMenu.commandId,
        );
        if (!command) return null;
        const items: MenuItem[] = [
          {
            get label() { return t("Edit"); },
            icon: "edit",
            disabled: libraryBusy,
            action: () => beginEdit(command),
          },
          {
            get label() { return t("Send Repeatedly"); },
            icon: "watch",
            action: () => beginRepeat(command.text, command.ending),
          },
          {
            get label() { return t("Line ending"); },
            icon: "newline",
            children: LINE_ENDINGS.map(([value, label]) => ({
              label,
              checked: command.ending === value,
              mark: "radio" as const,
              disabled: libraryBusy,
              action: () => void updateSaved(command, { ending: value }),
            })),
          },
          {
            get label() { return t("Scope"); },
            icon: "target",
            children: chain.map((scope) => ({
              label: labelOf(scope),
              checked: sameScope(command.scope, scope),
              mark: "radio" as const,
              disabled: libraryBusy,
              action: () => void updateSaved(command, { scope }),
            })),
          },
          "separator",
          {
            get label() { return t("Delete"); },
            icon: "trash",
            danger: true,
            disabled: libraryBusy,
            action: () => void removeCommand(command.id),
          },
        ];
        return (
          <ContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            items={items}
            onClose={closeContextMenu}
          />
        );
      })()}

      {commandTooltip && (
        <div
          className="sender-command-tooltip"
          role="tooltip"
          style={{ left: commandTooltip.x, top: commandTooltip.y }}
        >
          <div>{commandTooltip.text}</div>
          <span>{commandTooltip.details}</span>
        </div>
      )}
    </div>
  );
}

/** `90` → "1 min 30 s", `3600` → "1 h". */
function describeEvery(seconds: number): string {
  const parts: string[] = [];
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  if (hours > 0) parts.push(`${hours} h`);
  if (minutes > 0) parts.push(`${minutes} min`);
  if (rest > 0 || parts.length === 0) parts.push(`${rest} s`);
  return parts.join(" ");
}
