import Database from "better-sqlite3";
import { embed } from "./embed.ts";
import { getDbConn } from "./db.ts";
import { Chunk } from "./db.ts";
import * as repo from "./repository.ts";

export interface ScoredChunk {
  chunk: Chunk;
  bm25: number;
  vector: number;
  hybrid: number;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export function normalize(scores: number[]): number[] {
  const max = Math.max(...scores);
  const min = Math.min(...scores);
  const range = max - min;
  if (range === 0) return scores.map(() => 0);
  return scores.map(s => (s - min) / range);
}

function l2ToCosine(l2Dist: number): number {
  return 1 - (l2Dist * l2Dist) / 2;
}

function buildFtsQuery(query: string, op: "AND" | "OR"): string {
  const terms = query.split(/\s+/).filter(Boolean).map(t => `"${t.replace(/"/g, '""')}"`);
  return terms.join(` ${op} `);
}

/**
 * Hybrid search using SQLite FTS5 (BM25) + sqlite-vec (vector).
 */
export async function hybridSearch(
  query: string,
  limit = 10,
  alpha = 0.4,
  _db?: Database.Database
): Promise<ScoredChunk[]> {
  const database = _db ?? getDbConn();

  // Fast existence check — LIMIT 1 avoids full table scan
  if (!repo.hasAnyChunks(database)) return [];

  // BM25 via FTS5 — cap candidates to avoid scanning entire index
  const ftsLimit = Math.max(limit * 20, 200);
  let ftsResults = repo.searchFts(database, buildFtsQuery(query, "AND"), ftsLimit);
  if (ftsResults.length === 0) {
    // Requiring every term to appear zeroes out BM25 recall on any chunk that
    // paraphrases even one word. Retry with OR so lexical search can still
    // contribute a signal — vector search alone shouldn't have to carry it.
    const termCount = query.split(/\s+/).filter(Boolean).length;
    if (termCount > 1) {
      ftsResults = repo.searchFts(database, buildFtsQuery(query, "OR"), ftsLimit);
    }
  }

  // Vector via sqlite-vec
  const queryVec = await embed(query);
  const vecLimit = Math.max(limit * 10, 100);
  const vecResults = repo.searchVectors(database, queryVec, vecLimit);

  const ftsRowIds = new Set(ftsResults.map(r => r.rowid));
  const vecRowIds = new Set(vecResults.map(r => r.rowid));
  const allRowIds: Set<number> = new Set([...ftsRowIds, ...vecRowIds]);

  if (allRowIds.size === 0) return [];

  const chunks = repo.getChunksByRowids(database, Array.from(allRowIds));

  const chunkMap = new Map<number, typeof chunks[0]>();
  for (const c of chunks) chunkMap.set(c.rowid, c);

  const bm25Scores = ftsResults.map(r => r.bm25_score);
  const hasBm25 = bm25Scores.length > 0;
  const distances = vecResults.map(r => r.distance);
  const hasVectors = distances.length > 0;

  // Normalize BM25
  const bm25NormMap = new Map<number, number>();
  if (hasBm25) {
    const bm25Max = Math.max(...bm25Scores);
    const bm25Min = Math.min(...bm25Scores);
    const bm25Range = bm25Max - bm25Min;
    if (bm25Range === 0) {
      for (const r of ftsResults) {
        bm25NormMap.set(r.rowid, 1);
      }
    } else {
      // FTS5's bm25() returns *negative* scores where the BEST match is the
      // most negative (repo.searchFts relies on `ORDER BY bm25(...) ASC`).
      // Min-max must therefore peak at the most-negative score, not at the
      // max — otherwise the worst lexical match normalizes to 1.0 and the
      // best to 0.0, inverting the BM25 ranking (verified against FTS5).
      for (const r of ftsResults) {
        bm25NormMap.set(r.rowid, (bm25Max - r.bm25_score) / bm25Range);
      }
    }
  }

  // Normalize distances → cosine → min-max
  const vecNormMap = new Map<number, number>();
  if (hasVectors) {
    for (const r of vecResults) {
      vecNormMap.set(r.rowid, l2ToCosine(r.distance));
    }
    const cosines = Array.from(vecNormMap.values());
    const cosMax = Math.max(...cosines);
    const cosMin = Math.min(...cosines);
    const cosRange = cosMax - cosMin;
    if (cosRange > 0) {
      const normalized = new Map<number, number>();
      for (const [rowid, cos] of vecNormMap) {
        normalized.set(rowid, (cos - cosMin) / cosRange);
      }
      vecNormMap.clear();
      for (const [k, v] of normalized) vecNormMap.set(k, v);
    } else {
      for (const k of vecNormMap.keys()) vecNormMap.set(k, 1);
    }
  }

  // Build scored results
  const terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 1);
  const scored: ScoredChunk[] = [];

  // A retrieval path contributes to the hybrid score only when its weight is
  // non-zero. When vectors are absent the blend below collapses to pure BM25
  // (alpha is ignored), so BM25 always contributes; otherwise BM25 contributes
  // when alpha > 0 and vectors contribute when alpha < 1.
  //
  // We gate retention on *which path retrieved a chunk* rather than on the
  // normalized hybrid value. The previous `hybrid > 0` exit filter had two
  // failure modes that both produced hybrid === 0 but had opposite intent:
  //
  //   - the weakest *genuine* BM25 hit in a min-max set zeros out and gets
  //     dropped (min-max normalization floors the weakest at exactly 0),
  //     so e.g. the weaker of two lexical matches simply vanished; and
  //   - a vector-only neighbor under a pure-BM25 (alpha = 1) query also zeros
  //     out — correctly suppressed noise.
  //
  // Retrieval presence lets us tell them apart: keep a chunk iff it was
  // retrieved by a path that contributes to the blend under this alpha.
  const bm25Contributes = !hasVectors || alpha > 0;
  const vecContributes = hasVectors && alpha < 1;

  for (const rowid of allRowIds) {
    const c = chunkMap.get(rowid);
    if (!c) continue;

    // Drop chunks retrieved only by a path that doesn't blend under alpha
    // (e.g. vector-only neighbors of a pure-BM25 query) — those are noise.
    const relevant =
      (bm25Contributes && ftsRowIds.has(rowid)) ||
      (vecContributes && vecRowIds.has(rowid));
    if (!relevant) continue;

    const bm25Norm = bm25NormMap.get(rowid) ?? 0;
    const vecNorm = vecNormMap.get(rowid) ?? 0;

      let bm25Final = bm25Norm;
      // Boost when the first meaningful query term appears in the file path.
      // Guard on terms[0]: an empty/short query makes includes("") always true,
      // which would spuriously boost every result.
      if (terms[0] && c.file_path.toLowerCase().includes(terms[0])) {
        bm25Final = Math.min(1, bm25Final * 1.5);
      }

    const hybrid = hasVectors
      ? alpha * bm25Final + (1 - alpha) * vecNorm
      : bm25Final;

    scored.push({
      chunk: {
        id: c.id, file: c.file_path, content: c.chunk_content,
        lineStart: c.line_start, lineEnd: c.line_end,
        hash: c.chunk_hash, indexed: c.indexed_at, tokens: c.tokens,
      },
      bm25: bm25Final, vector: vecNorm, hybrid,
    });
  }

  return scored
    .sort((a, b) => b.hybrid - a.hybrid)
    .slice(0, limit);
}
