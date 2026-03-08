import { tool } from 'ai';
import { z } from 'zod';
import { parse as parseHtml } from 'node-html-parser';
import type { ToolContext } from '../types.js';

export function createFetchUrlTool(ctx: ToolContext) {
  const { provider, apiKey } = ctx.projectConfig.fetchUrl;

  return tool({
    description: 'Fetch a URL and extract its text content. Handles JS-rendered pages when using Jina.',
    inputSchema: z.object({
      url: z.string().url().describe('The URL to fetch'),
    }),
    execute: async ({ url }) => {
      if (provider === 'jina') {
        return jinaFetch(url, apiKey);
      }
      return localFetch(url);
    },
  });
}

/** Jina Reader — returns clean Markdown, handles JS-rendered pages */
async function jinaFetch(url: string, apiKey?: string): Promise<{ url: string; text: string; length: number }> {
  const headers: Record<string, string> = {
    Accept: 'text/plain',
  };
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const res = await fetch(`https://r.jina.ai/${url}`, {
    headers,
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) throw new Error(`Jina fetch failed: ${res.status}`);

  let text = await res.text();

  // Cap at 8000 chars to prevent context blowout
  if (text.length > 8000) {
    text = text.slice(0, 8000) + '\n\n... [truncated]';
  }

  return { url, text, length: text.length };
}

/** Local fetch — parses HTML with node-html-parser, no JS rendering */
async function localFetch(url: string): Promise<{ url: string; text: string; length: number }> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'wa-agent/0.1 (bot)' },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);

  const html = await res.text();
  const root = parseHtml(html);

  root.querySelectorAll('script, style, nav, footer, header').forEach(el => el.remove());

  const main = root.querySelector('main') || root.querySelector('article') || root.querySelector('body');
  let text = main?.textContent?.trim() || '';

  text = text.replace(/\s+/g, ' ').trim();

  if (text.length > 8000) {
    text = text.slice(0, 8000) + '... [truncated]';
  }

  return { url, text, length: text.length };
}
