import { tool } from 'ai';
import { z } from 'zod';
import { sendText } from '@ibrahimwithi/wu-cli';
import { setHandoffState } from '../../memory/store.js';
import type { ToolContext } from '../types.js';

export function createHandoffTool(ctx: ToolContext) {
  return tool({
    description: 'Escalate the conversation to a human operator. Use when the user needs human assistance.',
    inputSchema: z.object({
      reason: z.string().describe('Reason for escalation'),
      summary: z.string().describe('Brief summary of the conversation for the operator'),
    }),
    execute: async ({ reason, summary }) => {
      const escalateTo = ctx.agentConfig.handoff?.escalateTo;
      if (!escalateTo) {
        return { handedOff: false, error: 'No handoff target configured' };
      }

      // Mark chat as handed off
      setHandoffState(ctx.agentConfig.name, ctx.chatJid, true);

      // Notify the operator
      const notification = `🔔 *Handoff from ${ctx.agentConfig.name}*\n\n` +
        `*Chat:* ${ctx.chatJid}\n` +
        `*Reason:* ${reason}\n\n` +
        `*Summary:*\n${summary}`;

      await sendText(ctx.sock, escalateTo, notification, ctx.config);

      // Notify the user
      await sendText(
        ctx.sock,
        ctx.chatJid,
        "I've connected you with a human team member. They'll be with you shortly.",
        ctx.config,
      );

      return { handedOff: true, escalatedTo: escalateTo, reason };
    },
  });
}
