import { tool } from 'ai';
import { z } from 'zod';
import { searchMessages } from '@ibrahimwithi/wu-cli';
import type { ToolContext } from '../types.js';

export function createSearchMessagesTool(ctx: ToolContext) {
  return tool({
    description: 'Search message history using full-text search',
    inputSchema: z.object({
      query: z.string().describe('Search query'),
      chatJid: z.string().optional().describe('Limit search to specific chat'),
      limit: z.number().optional().default(10).describe('Max results'),
    }),
    execute: async ({ query, chatJid, limit }) => {
      const results = searchMessages(query, {
        chatJid: chatJid || ctx.chatJid,
        limit,
      });
      return results.map(r => ({
        id: r.id,
        chatJid: r.chat_jid,
        sender: r.sender_name || r.sender_jid,
        body: r.body,
        timestamp: r.timestamp,
        snippet: r.snippet,
      }));
    },
  });
}
