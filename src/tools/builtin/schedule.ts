import { tool } from 'ai';
import { z } from 'zod';
import { insertScheduledTask } from '../../memory/store.js';
import type { ToolContext } from '../types.js';

export function createScheduleTool(ctx: ToolContext) {
  return tool({
    description: 'Schedule a message to be sent at a future time',
    inputSchema: z.object({
      text: z.string().describe('Message text to send'),
      runAt: z.number().describe('Unix timestamp (seconds) for when to send'),
      target: z.string().optional().describe('Target JID. Defaults to current chat.'),
    }),
    execute: async ({ text, runAt, target }) => {
      const targetJid = target || ctx.chatJid;
      insertScheduledTask({
        agentName: ctx.agentConfig.name,
        target: targetJid,
        action: 'send-message',
        payload: JSON.stringify({ text }),
        nextRunAt: runAt,
        isRecurring: 0,
        cronExpression: null,
      });
      return {
        scheduled: true,
        target: targetJid,
        runAt,
        text: text.slice(0, 50) + (text.length > 50 ? '...' : ''),
      };
    },
  });
}
