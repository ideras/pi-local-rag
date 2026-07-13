/**
 * Minimal `Theme` shim for the standalone CLI.
 *
 * The `/rag` command handlers only ever call `th.fg(color, text)` and
 * `th.bold(text)` (audited across `commands/*.ts`). This stub implements
 * exactly those with ANSI codes when color is enabled, and returns the raw
 * string otherwise. The remaining `Theme` methods are identity passthroughs so
 * a future handler that grows a new dependency degrades gracefully (plain
 * text) rather than crashing.
 *
 * We deliberately avoid importing the real `Theme` from the SDK so the CLI
 * runtime stays free of TUI dependencies.
 */
const FG_ANSI: Record<string, string> = {
  accent: "\x1b[36m",
  border: "\x1b[90m",
  borderAccent: "\x1b[36m",
  borderMuted: "\x1b[90m",
  success: "\x1b[32m",
  error: "\x1b[31m",
  warning: "\x1b[33m",
  muted: "\x1b[90m",
  dim: "\x1b[2m",
  text: "\x1b[39m",
  thinkingText: "\x1b[35m",
  userMessageText: "\x1b[39m",
  customMessageText: "\x1b[39m",
  customMessageLabel: "\x1b[36m",
  toolTitle: "\x1b[36m",
  toolOutput: "\x1b[39m",
  mdHeading: "\x1b[1m",
  mdLink: "\x1b[34m",
  mdLinkUrl: "\x1b[90m",
  mdCode: "\x1b[36m",
  mdCodeBlock: "\x1b[2m",
  mdCodeBlockBorder: "\x1b[90m",
  mdQuote: "\x1b[2m",
  mdQuoteBorder: "\x1b[90m",
  mdHr: "\x1b[90m",
  mdListBullet: "\x1b[36m",
  toolDiffAdded: "\x1b[32m",
  toolDiffRemoved: "\x1b[31m",
  toolDiffContext: "\x1b[2m",
  syntaxComment: "\x1b[2m",
  syntaxKeyword: "\x1b[35m",
  syntaxFunction: "\x1b[33m",
  syntaxVariable: "\x1b[36m",
  syntaxString: "\x1b[32m",
  syntaxNumber: "\x1b[33m",
  syntaxType: "\x1b[36m",
  syntaxOperator: "\x1b[39m",
  syntaxPunctuation: "\x1b[90m",
};

const RESET = "\x1b[0m";

export interface CliTheme {
  fg(color: string, text: string): string;
  bg(color: string, text: string): string;
  bold(text: string): string;
  italic(text: string): string;
  underline(text: string): string;
  inverse(text: string): string;
  strikethrough(text: string): string;
}

export function createCliTheme({ color }: { color: boolean }): CliTheme {
  const wrap = (open: string, text: string): string =>
    color ? `${open}${text}${RESET}` : text;
  const bg = (_c: string, text: string): string => text;
  return {
    fg: (c: string, text: string) => wrap(FG_ANSI[c] ?? "", text),
    bg,
    bold: (text: string) => wrap("\x1b[1m", text),
    italic: (text: string) => wrap("\x1b[3m", text),
    underline: (text: string) => wrap("\x1b[4m", text),
    inverse: (text: string) => wrap("\x1b[7m", text),
    strikethrough: (text: string) => wrap("\x1b[9m", text),
  };
}