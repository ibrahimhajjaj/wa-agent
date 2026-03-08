import { tool } from 'ai';
import { z } from 'zod';
import { sendReaction } from '@ibrahimwithi/wu-cli';
import type { ToolContext } from '../types.js';

export function createSendReactionTool(ctx: ToolContext) {
  return tool({
    description: 'React to a message with an emoji',
    inputSchema: z.object({
      messageId: z.string().describe('ID of the message to react to'),
      emoji: z.string().describe('Emoji to react with'),
    }),
    execute: async ({ messageId, emoji }) => {
      await sendReaction(ctx.sock, ctx.chatJid, messageId, emoji, ctx.config);
      return { reacted: true, messageId, emoji };
    },
  });
}
