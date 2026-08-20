/**
 * Lightweight memory retrieval: lexical scoring over folded memory entries.
 * No embedding dependency — query and entry text are tokenized to lowercase
 * word terms, overlap is counted, and exact tag hits weigh double. Pure
 * functions; the log remains the only state.
 *
 * @module dsh-swarm-panel
 */

import type { SwarmMemoryEntry, SwarmMemoryHit } from './types.ts'

/** A tag exact hit weighs this many text-token hits. */
const TAG_WEIGHT = 2

/**
 * Split text into lowercase word terms (Unicode letters/digits).
 * @param text - query or memory text.
 * @returns distinct terms in first-appearance order.
 */
export function tokenize(text: string): string[] {
  const terms = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
  return [...new Set(terms)]
}

/**
 * Score one entry against a query: one point per query term present in the
 * entry text, {@link TAG_WEIGHT} points per term exactly matching a tag.
 * @param entry - the memory entry.
 * @param queryTerms - distinct lowercase query terms ({@link tokenize} output).
 * @returns the relevance score; 0 means unrelated.
 */
export function scoreMemory(entry: SwarmMemoryEntry, queryTerms: readonly string[]): number {
  if (queryTerms.length === 0) return 0
  const textTerms = new Set(tokenize(entry.text))
  const tags = new Set((entry.tags ?? []).map(tag => tag.toLowerCase()))
  let score = 0
  for (const term of queryTerms) {
    if (textTerms.has(term)) score += 1
    if (tags.has(term)) score += TAG_WEIGHT
  }
  return score
}

/**
 * Rank entries against a query: positive scores only, highest first; ties
 * resolve to the LATER write (recency wins because the input is in write
 * order and the comparator prefers the bigger index).
 * @param entries - memory entries in write order (the fold view).
 * @param query - free-text query.
 * @param limit - maximum hits (positive integer).
 * @returns scored hits, best first.
 */
export function queryMemories(
  entries: readonly SwarmMemoryEntry[],
  query: string,
  limit: number,
): SwarmMemoryHit[] {
  const queryTerms = tokenize(query)
  const scored: Array<{ entry: SwarmMemoryEntry; index: number; score: number }> = []
  for (const [index, entry] of entries.entries()) {
    const score = scoreMemory(entry, queryTerms)
    if (score > 0) scored.push({ entry, index, score })
  }
  scored.sort((left, right) => right.score - left.score || right.index - left.index)
  return scored.slice(0, limit).map(({ entry, score }) => ({ ...entry, score }))
}
