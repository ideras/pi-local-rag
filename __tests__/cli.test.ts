/**
 * Tests for the standalone CLI: argv parsing, alias resolution, and the
 * `--rag-dir` forms. The arg parser is pure (no I/O) so it's tested directly;
 * the dispatch shim is exercised end-to-end in manual smoke tests (see
 * CLI-PLAN.md).
 */
import { describe, it, expect } from "vitest";
import { parseArgs } from "../cli/args.ts";

describe("cli/args parseArgs", () => {
  it("parses a simple subcommand + args", () => {
    const r = parseArgs(["index", "./src"]);
    expect(r.command).toBe("index");
    expect(r.args).toEqual(["./src"]);
    expect(r.flags.ragDir).toBeUndefined();
    expect(r.error).toBeUndefined();
  });

  it("defaults to the `help` subcommand when given no args", () => {
    const r = parseArgs([]);
    expect(r.command).toBe("help");
    expect(r.args).toEqual([]);
  });

  it("expands the `reindex` alias to `rebuild`", () => {
    const r = parseArgs(["reindex", "--force"]);
    expect(r.command).toBe("rebuild");
    expect(r.args).toEqual(["--force"]); // command-specific flag passes through
  });

  it("keeps command-specific flags (e.g. --force) in args", () => {
    const r = parseArgs(["rebuild", "--force"]);
    expect(r.command).toBe("rebuild");
    expect(r.args).toEqual(["--force"]);
  });

  it("parses --rag-dir <path> (space form) wherever it appears", () => {
    const r = parseArgs(["rebuild", "--force", "--rag-dir", "/tmp/foo"]);
    expect(r.flags.ragDir).toBe("/tmp/foo");
    expect(r.args).toEqual(["--force"]); // rag-dir + value stripped from args
    expect(r.command).toBe("rebuild");
  });

  it("parses --rag-dir=<path> (equals form)", () => {
    const r = parseArgs(["status", "--rag-dir=/tmp/bar"]);
    expect(r.flags.ragDir).toBe("/tmp/bar");
    expect(r.args).toEqual([]);
  });

  it("parses --rag-dir <path> before the subcommand", () => {
    const r = parseArgs(["--rag-dir", "/tmp/x", "status"]);
    expect(r.flags.ragDir).toBe("/tmp/x");
    expect(r.command).toBe("status");
    expect(r.args).toEqual([]);
  });

  it("errors when --rag-dir has no value", () => {
    const r = parseArgs(["status", "--rag-dir"]);
    expect(r.error).toBe("--rag-dir requires a value");
  });

  it("parses --no-color", () => {
    expect(parseArgs(["status", "--no-color"]).flags.noColor).toBe(true);
    expect(parseArgs(["status"]).flags.noColor).toBe(false);
  });

  it("parses --help / -h", () => {
    expect(parseArgs(["--help"]).flags.help).toBe(true);
    expect(parseArgs(["-h"]).flags.help).toBe(true);
    expect(parseArgs(["status"]).flags.help).toBe(false);
  });

  it("parses --version / -V", () => {
    expect(parseArgs(["--version"]).flags.version).toBe(true);
    expect(parseArgs(["-V"]).flags.version).toBe(true);
  });

  it("passes exclude-remove patterns like `-dist` through as positional", () => {
    // `-h` is reserved for help, but other leading-dash tokens (the exclude
    // remove syntax) must survive into args.
    const r = parseArgs(["exclude", "-dist"]);
    expect(r.command).toBe("exclude");
    expect(r.args).toEqual(["-dist"]);
  });

  it("rejoins a multi-word query as separate args (matches /rag split)", () => {
    // The extension dispatches via `rawArgs.trim().split(/\s+/)`, so a quoted
    // query arrives as separate argv tokens; searchCommand rejoins them.
    const r = parseArgs(["search", "hybrid", "bm25", "search"]);
    expect(r.command).toBe("search");
    expect(r.args).toEqual(["hybrid", "bm25", "search"]);
  });
});