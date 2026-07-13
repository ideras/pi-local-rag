/**
 * Standalone CLI adapter for the `/rag` command handlers.
 *
 * The handlers in `commands/*.ts` take `{ ctx, args }` where `ctx` is an
 * `ExtensionCommandContext`. They only touch a tiny slice of `ctx.ui`:
 *
 *   - `notify(message, type?)`            — status / progress / errors
 *   - `setStatus(key, text | undefined)` — single-line progress bar
 *   - `setWidget(key, lines | undefined)` — multi-line panel
 *   - `theme`                             — `theme.bold()` / `theme.fg()`
 *
 * This module builds a minimal shim satisfying exactly that slice, mapping
 * each call to stdout/stderr:
 *
 *   - `notify(msg, "info")`    → stdout
 *   - `notify(msg, "warning")` → stderr (prefixed `!`)
 *   - `notify(msg, "error")`   → stderr (prefixed `✖`) AND marks the run failed
 *     so the CLI exits non-zero (agreed: error-type notifications → exit 1).
 *   - `setStatus(_, text)`    → stderr, single line with `\r` (progress)
 *   - `setWidget("rag", …)`   → stderr (live progress bar from
 *     makeProgressCallbacks; keeps piped stdout clean)
 *   - `setWidget("rag-info", …)` → stdout, joined with newlines (final result
 *     panel from status/search/find/help/ext/exclude via setInfoWidget)
 *
 * Every other `ExtensionUIContext` / `ExtensionCommandContext` member is a
 * throwing/no-op stub so a future handler that grows a new dependency fails
 * loudly instead of silently no-op'ing. The types are imported as type-only so
 * the bundled CLI has no runtime dependency on `@mariozechner/pi-coding-agent`.
 */
import type { ExtensionCommandContext, ExtensionUIContext } from "@mariozechner/pi-coding-agent";

import { createCliTheme, type CliTheme } from "./theme.ts";

const INTERACTIVE_UNAVAILABLE =
  "interactive UI is not available in CLI mode";

/** A dialog shim that always rejects — handlers must not call these in CLI. */
function rejectDialog() {
  throw new Error(INTERACTIVE_UNAVAILABLE);
}

export interface CliContextResult {
  ctx: ExtensionCommandContext;
  /** True if any `notify(..., "error")` was called during the run. */
  hadError: () => boolean;
}

export function createCliContext({ color }: { color: boolean }): CliContextResult {
  const theme: CliTheme = createCliTheme({ color });
  let _hadError = false;

  const ui = {
    notify: (message: string, type?: "info" | "warning" | "error"): void => {
      const t = type ?? "info";
      if (t === "error") {
        _hadError = true;
        process.stderr.write(`✖ ${message}\n`);
      } else if (t === "warning") {
        process.stderr.write(`! ${message}\n`);
      } else {
        process.stdout.write(`${message}\n`);
      }
    },
    setStatus: (_key: string, text: string | undefined): void => {
      // Single-line progress on stderr so it never pollutes piped stdout.
      process.stderr.write(text === undefined ? "\r\x1b[2K" : `\r\x1b[2K${text}`);
    },
    setWidget: (key: string, lines: string[] | undefined): void => {
      if (!lines || !lines.length) {
        // clear: reset any in-flight progress line on stderr.
        if (key === "rag") process.stderr.write("\r\x1b[2K");
        return;
      }
      // The progress callbacks (makeProgressCallbacks) write the live progress
      // bar under the "rag" widget key; the final result panels
      // (status/search/find/help/ext/exclude) use "rag-info" (see
      // commands/widget.ts). Route progress to stderr so piped stdout stays
      // clean — only the result panel goes to stdout.
      const stream = key === "rag" ? process.stderr : process.stdout;
      if (key === "rag") stream.write("\r\x1b[2K");
      stream.write(lines.join("\n") + (key === "rag" ? "\r" : "\n"));
    },
    theme,
    // ── Interactive members — must never be reached from a command handler ──
    select: rejectDialog,
    confirm: rejectDialog,
    input: rejectDialog,
    onTerminalInput: () => () => {},
    setWorkingMessage: () => {},
    setWorkingVisible: () => {},
    setWorkingIndicator: () => {},
    setHiddenThinkingLabel: () => {},
    setFooter: () => {},
    setHeader: () => {},
    setTitle: () => {},
    custom: rejectDialog,
    pasteToEditor: () => {},
    setEditorText: () => {},
    getEditorText: () => "",
    editor: rejectDialog,
    addAutocompleteProvider: () => {},
    setEditorComponent: () => {},
    getEditorComponent: () => undefined,
    getAllThemes: () => [],
    getTheme: () => undefined,
    setTheme: () => ({ success: false, error: "themes unavailable in CLI" }),
    getToolsExpanded: () => false,
    setToolsExpanded: () => {},
  } as unknown as ExtensionUIContext;

  const ctx = {
    ui,
    mode: "print" as const,
    hasUI: false,
    cwd: process.cwd(),
    isIdle: () => true,
    isProjectTrusted: () => true,
    signal: undefined,
    abort: () => {},
    hasPendingMessages: () => false,
    shutdown: () => {},
    getContextUsage: () => undefined,
    compact: () => {},
    getSystemPrompt: () => "",
    // ExtensionCommandContext extras — unused by handlers, throw if touched.
    getSystemPromptOptions: rejectDialog,
    waitForIdle: async () => {},
    newSession: rejectDialog,
    fork: rejectDialog,
    navigateTree: rejectDialog,
    switchSession: rejectDialog,
    reload: rejectDialog,
    // sessionManager / modelRegistry / model are on ExtensionContext; stub them
    // so misuse is loud rather than silently undefined.
    sessionManager: new Proxy({}, { get: () => rejectDialog }) as unknown,
    modelRegistry: new Proxy({}, { get: () => rejectDialog }) as unknown,
    model: undefined,
  } as unknown as ExtensionCommandContext;

  return { ctx, hadError: () => _hadError };
}