// Command-palette ranking — match quality, not table order.
//
// The palette filtered with a bare `label.includes(q)` and showed whatever came
// first in the command table. That table is ordered by *group* (layout presets,
// then destinations, then git, then add-pane, ...), so typing "git" put
// `Layout: Git review` above the command whose label is exactly `Git` — a preset
// shadowed the destination it competes with, and Enter did the wrong thing.
// Table order is not a claim about relevance, so relevance has to be scored.
//
// Tiers, best first. Ties keep table order: the index is compared explicitly
// rather than trusting the engine's sort to stay stable.

export interface Rankable {
  label: string;
  description?: string;
}

const EXACT = 100;
const PREFIX = 80;
const WORD_START = 60;
const SUBSTRING = 40;
const DESCRIPTION = 20;

/** How well one command answers the query. 0 means it does not match at all. */
export function matchScore(item: Rankable, query: string): number {
  const q = query.trim().toLowerCase();
  // An empty query is not a filter: every command answers it equally, and table
  // order is the only ordering that means anything.
  if (!q) return DESCRIPTION;

  const label = item.label.toLowerCase();
  if (label === q) return EXACT;
  if (label.startsWith(q)) return PREFIX;
  // Typing "git" must reach "Layout: Git review" and "Add Pane: Git Status" —
  // the user meant the start of a word, not the middle of one.
  if (label.split(/[^a-z0-9]+/).some((word) => word.startsWith(q))) return WORD_START;
  if (label.includes(q)) return SUBSTRING;
  if (item.description?.toLowerCase().includes(q)) return DESCRIPTION;
  return 0;
}

/** The commands that match, best first; table order breaks every tie. */
export function rankCommands<T extends Rankable>(commands: T[], query: string): T[] {
  if (!query.trim()) return commands;
  return commands
    .map((command, index) => ({ command, index, score: matchScore(command, query) }))
    .filter((ranked) => ranked.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((ranked) => ranked.command);
}
