import { tool } from 'ai';
import { z } from 'zod';
import { sendText, sendMedia } from '@ibrahimwithi/wu-cli';
import type { ToolContext } from '../types.js';

export function createSendMessageTool(ctx: ToolContext) {
  return tool({
    description: 'Send a text or media message to a WhatsApp chat',
    inputSchema: z.object({
      to: z.string().optional().describe('JID to send to. Defaults to current chat.'),
      text: z.string().optional().describe('Text message to send'),
      mediaPath: z.string().optional().describe('Path to media file to send'),
      caption: z.string().optional().describe('Caption for media message'),
    }),
    execute: async ({ to, text, mediaPath, caption }) => {
      const targetJid = to || ctx.chatJid;

      if (mediaPath) {
        await sendMedia(ctx.sock, targetJid, mediaPath, ctx.config, { caption });
        return { sent: true, type: 'media', to: targetJid };
      }

      if (text) {
        await sendText(ctx.sock, targetJid, text, ctx.config);
        return { sent: true, type: 'text', to: targetJid };
      }

      return { sent: false, error: 'No text or media provided' };
    },
  });
}
