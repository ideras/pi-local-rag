/**
 * CLI argument parser.
 *
 * Splits `process.argv` into:
 *   - global flags: `--rag-dir <path>` / `--rag-dir=<path>`, `--no-color`,
 *     `--help` / `-h`, `--version` / `-V`
 *   - a subcommand (first non-flag token) + its args (the remaining tokens,
 *     with global flags stripped out)
 *
 * Global flags may appear before OR after the subcommand (e.g.
 * `pi-local-rag rebuild --force --rag-dir /tmp/foo`).
 *
 * Command-specific flags such as `rebuild --force` are NOT global — they pass
 * through into `args` untouched, matching how the handler reads them
 * (`args.includes("--force")`).
 *
 * Aliases:
 *   - `reindex` → `rebuild`   (the canonical command name is `rebuild`)
 *   - no subcommand           → `help`
 */

export interface ParsedArgs {
  command: string;
  /** Everything after the subcommand name, global flags stripped. */
  args: string[];
  flags: {
    ragDir?: string;
    noColor: boolean;
    help: boolean;
    version: boolean;
  };
  /** Present when parsing failed (e.g. `--rag-dir` with no value). */
  error?: string;
}

const COMMAND_ALIASES: Record<string, string> = {
  reindex: "rebuild",
};

export function parseArgs(argv: string[]): ParsedArgs {
  const flags: ParsedArgs["flags"] = { noColor: false, help: false, version: false };
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];

    if (t === "--rag-dir") {
      const v = argv[i + 1];
      if (v === undefined) {
        return { command: "", args: [], flags, error: "--rag-dir requires a value" };
      }
      flags.ragDir = v;
      i++; // consume value
      continue;
    }
    if (t.startsWith("--rag-dir=")) {
      flags.ragDir = t.slice("--rag-dir=".length);
      continue;
    }
    if (t === "--no-color") { flags.noColor = true; continue; }
    if (t === "--help" || t === "-h") { flags.help = true; continue; }
    if (t === "--version" || t === "-V") { flags.version = true; continue; }

    // Anything else is positional (subcommand or its args), including
    // command-specific flags like `--force` and exclude-remove patterns like
    // `-dist`.
    positional.push(t);
  }

  let command = positional[0] ?? "help";
  const args = positional.slice(1);

  command = COMMAND_ALIASES[command] ?? command;

  return { command, args, flags };
}