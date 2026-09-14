import type { AskMode } from '@lumina/contract';
import { fetchPage } from './fetch-page.js';
import { recallMemory, saveMemory } from './memory.js';
import { searchDocuments } from './search-documents.js';
import { webSearch } from './web-search.js';
import type { Tool, ToolResult } from './types.js';

export const ALL_TOOLS: Tool[] = [webSearch, fetchPage, searchDocuments, recallMemory, saveMemory];

export const TOOLS_BY_NAME = new Map(ALL_TOOLS.map((t) => [t.name, t]));

/**
 * The model's tool list is filtered before the call, not policed after it. `plan_research` is
 * not in this registry at all on a quick run — the surest way to stop a quick search escalating
 * itself is for the expensive tool to be unreachable rather than forbidden.
 */
export function toolsForMode(mode: AskMode): Tool[] {
  switch (mode) {
    case 'web':
      return [webSearch, fetchPage, recallMemory, saveMemory];
    case 'docs':
      return [searchDocuments, recallMemory, saveMemory];
    case 'auto':
    default:
      return [webSearch, fetchPage, searchDocuments, recallMemory, saveMemory];
  }
}

export { fetchPage, recallMemory, saveMemory, searchDocuments, webSearch };
export type { Tool, ToolResult };
