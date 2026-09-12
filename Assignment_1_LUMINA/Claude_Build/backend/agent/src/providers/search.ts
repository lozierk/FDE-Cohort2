export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  /** Extracted page text, when the provider returned it. This is what an answer is built from. */
  content?: string;
}

export interface SearchProvider {
  readonly name: 'tavily' | 'serpapi' | 'fake';
  search(query: string, signal?: AbortSignal): Promise<SearchResult[]>;
}
