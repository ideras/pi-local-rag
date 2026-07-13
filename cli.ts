#!/usr/bin/env node
/**
 * pi-local-rag — standalone CLI.
 *
 * Runs any `/rag` subcommand from the shell, e.g.:
 *
 *   pi-local-rag status
 *   pi-local-rag index ./src
 *   pi-local-rag search "hybrid bm25"
 *   pi-local-rag reindex --force        (alias for `rebuild --force`)
 *   pi-local-rag refresh
 *   pi-local-rag find "*.ts"
 *   pi-local-rag clear
 *   pi-local-rag exclude dist
 *   pi-local-rag ext list
 *   pi-local-rag on | off
 *   pi-local-rag help
 *
 * Global flags (may appear before or after the subcommand):
 *   --rag-dir <path> | --rag-dir=<path>   override the RAG store directory
 *   --no-color                            disable ANSI colors
 *   --help, -h                            show help
 *   --version, -V                         print version and exit
 *
 * This entry intentionally does NOT use the extension's default export (which
 * registers auto-injection, MCP tools, and the `/rag` slash command). It
 * imports the command registry directly and dispatches, faking the small
 * `ctx.ui` slice the handlers need (see `cli/context.ts`).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { setRagDirGetter } from "./store.ts";
import { closeDbConn } from "./db.ts";
import { RAG_COMMANDS } from "./commands/registry.ts";
import { RAG_COMMAND_META } from "./commands/metadata.ts";
import { parseArgs } from "./cli/args.ts";
import { createCliContext } from "./cli/context.ts";

function readVersion(): string {
  try {
    // dist/cli.js → ../package.json (package root).
    const url = new URL("../package.json", import.meta.url);
    const pkg = JSON.parse(readFileSync(fileURLToPath(url), "utf8"));
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

function printHelp(): void {
  const lines: string[] = [
    `pi-local-rag v${readVersion()} — local hybrid RAG (BM25 + vector)`,
    "",
    "Usage: pi-local-rag <command> [args] [global flags]",
    "",
    "Commands:",
  ];
  const COL = 28;
  for (const { name, usage, helpText } of RAG_COMMAND_META) {
    // metadata.usage is written for the `/rag` slash command; show the bare
    // command form for the CLI.
    const cmdUsage = usage.replace(/^\/rag\s+/, "");
    const label = name === "rebuild" ? `${cmdUsage}  (alias: reindex)` : cmdUsage;
    lines.push(`  ${label.padEnd(COL)}  ${helpText}`);
  }
  lines.push(
    "",
    "Global flags:",
    "  --rag-dir <path>            RAG store directory override (also --rag-dir=<path>, $PI_RAG_DIR)",
    "  --no-color                  disable ANSI colors (also NO_COLOR=1)",
    "  --help, -h                  show this help",
    "  --version, -V               print version and exit",
    "",
    "Exit codes: 0 success · 1 runtime error or handler-reported error · 2 bad usage",
  );
  process.stdout.write(lines.join("\n") + "\n");
}

async function main(): Promise<number> {
  const { command, args, flags, error } = parseArgs(process.argv.slice(2));

  if (error) {
    process.stderr.write(`✖ ${error}\n`);
    printHelp();
    return 2;
  }
  if (flags.version) {
    process.stdout.write(`pi-local-rag v${readVersion()}\n`);
    return 0;
  }
  if (flags.help || command === "help") {
    // `help` command handler also exists in the registry; route the explicit
    // --help flag through our richer printHelp() for the global-flags section.
    // The `help` *subcommand* is dispatched to the registry handler below.
    if (flags.help || (command === "help" && args.length === 0)) {
      printHelp();
      return 0;
    }
  }

  // Wire --rag-dir (if given) into the store's resolution chain. Otherwise
  // getRagDir() walks cwd → ~/.pi/rag exactly as the extension does.
  if (flags.ragDir) {
    setRagDirGetter(() => flags.ragDir);
  }

  const color =
    !flags.noColor &&
    !process.env.NO_COLOR &&
    !!process.stdout.isTTY;

  const { ctx, hadError } = createCliContext({ color });

  const def = RAG_COMMANDS[command];
  if (!def) {
    process.stderr.write(`✖ Unknown command: ${command}\n`);
    printHelp();
    return 2;
  }

  try {
    await def.handler({ ctx, args });
  } catch (e) {
    process.stderr.write(`✖ ${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  } finally {
    // Mirror the extension's session_shutdown handler so the SQLite handle is
    // released before exit (important for better-sqlite3 under some runtimes).
    try { closeDbConn(); } catch { /* already closed */ }
  }

  // Handler-reported "error" notifications → non-zero exit (agreed).
  return hadError() ? 1 : 0;
}

main()
  .then((code) => {
    // Force exit so the widget auto-clear timer in commands/widget.ts (45s)
    // can't keep the process alive after a one-shot command.
    process.exit(code);
  })
  .catch((e) => {
    process.stderr.write(`✖ ${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  });