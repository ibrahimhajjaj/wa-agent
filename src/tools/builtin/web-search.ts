import { tool } from 'ai';
import { z } from 'zod';
import type { ToolContext } from '../types.js';

export function createWebSearchTool(ctx: ToolContext) {
  const { provider, apiKey } = ctx.projectConfig.webSearch;

  return tool({
    description: 'Search the web for current information',
    inputSchema: z.object({
      query: z.string().describe('The search query'),
    }),
    execute: async ({ query }) => {
      switch (provider) {
        case 'tavily':
          return tavilySearch(query, apiKey);
        case 'brave':
          return braveSearch(query, apiKey);
        case 'serper':
          return serperSearch(query, apiKey);
        default:
          throw new Error(`Unknown web search provider: ${provider}`);
      }
    },
  });
}

async function tavilySearch(query: string, apiKey?: string) {
  if (!apiKey) throw new Error('Tavily API key not configured');
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      max_results: 5,
      include_answer: true,
    }),
  });
  if (!res.ok) throw new Error(`Tavily search failed: ${res.status}`);
  const data = await res.json();
  return {
    answer: data.answer,
    results: data.results?.map((r: any) => ({
      title: r.title,
      url: r.url,
      content: r.content,
    })),
  };
}

async function braveSearch(query: string, apiKey?: string) {
  if (!apiKey) throw new Error('Brave API key not configured');
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5`;
  const res = await fetch(url, {
    headers: { 'X-Subscription-Token': apiKey, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Brave search failed: ${res.status}`);
  const data = await res.json();
  return {
    results: data.web?.results?.map((r: any) => ({
      title: r.title,
      url: r.url,
      content: r.description,
    })),
  };
}

async function serperSearch(query: string, apiKey?: string) {
  if (!apiKey) throw new Error('Serper API key not configured');
  const res = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-KEY': apiKey },
    body: JSON.stringify({ q: query, num: 5 }),
  });
  if (!res.ok) throw new Error(`Serper search failed: ${res.status}`);
  const data = await res.json();
  return {
    results: data.organic?.map((r: any) => ({
      title: r.title,
      url: r.link,
      content: r.snippet,
    })),
  };
}
