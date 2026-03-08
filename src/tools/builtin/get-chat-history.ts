import { tool } from 'ai';
import { z } from 'zod';
import { listMessages } from '@ibrahimwithi/wu-cli';
import type { ToolContext } from '../types.js';

export function createGetChatHistoryTool(ctx: ToolContext) {
  return tool({
    description: 'Get recent messages from a chat',
    inputSchema: z.object({
      chatJid: z.string().optional().describe('Chat JID. Defaults to current chat.'),
      limit: z.number().optional().default(20).describe('Number of messages to retrieve'),
    }),
    execute: async ({ chatJid, limit }) => {
      const messages = listMessages({
        chatJid: chatJid || ctx.chatJid,
        limit,
      });
      return messages.map(m => ({
        id: m.id,
        sender: m.sender_name || m.sender_jid,
        body: m.body,
        type: m.type,
        isFromMe: m.is_from_me === 1,
        timestamp: m.timestamp,
      }));
    },
  });
}
