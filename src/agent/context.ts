import type { ModelMessage } from 'ai';
import type { AgentConfig } from './types.js';
import type { ToolContext } from '../tools/types.js';
import { listMessages, type MessageRow } from '@ibrahimwithi/wu-cli';
import { getConversation } from '../memory/store.js';
import { getUserProfile } from '../memory/profiles.js';

/** Format a stored message for LLM context */
function formatMessageForLLM(msg: MessageRow, chatJid: string): string {
  const text = msg.body ?? `[${msg.type}]`;
  if (msg.is_from_me) return text;

  // Only prefix with sender name in group chats
  if (chatJid.endsWith('@g.us')) {
    const sender = msg.sender_name ?? msg.sender_jid?.split('@')[0] ?? 'Unknown';
    return `[${sender}]: ${text}`;
  }
  return text;
}

export function buildContext(config: AgentConfig, ctx: ToolContext): ModelMessage[] {
  const parts: ModelMessage[] = [];

  // 1. Build ONE system message
  let system = config.personality;

  if (config.handoff?.conditions?.length) {
    system += `\n\nEscalate to a human when: ${config.handoff.conditions.join('; ')}`;
  }

  if (config.memory.userProfiles && ctx.senderJid) {
    const profile = getUserProfile(config.name, ctx.senderJid);
    if (profile?.facts) {
      system += `\n\nKnown facts about this user:\n${profile.facts}`;
    }
  }

  const convo = getConversation(config.name, ctx.chatJid);
  if (convo?.summary) {
    system += `\n\nPrevious conversation summary:\n${convo.summary}`;
  }

  parts.push({ role: 'system', content: system });

  // 2. Recent messages from wu-cli's messages table
  const afterTimestamp = convo?.summaryUpToTimestamp ?? undefined;
  const history = listMessages({
    chatJid: ctx.chatJid,
    limit: config.memory.conversationWindow,
    after: afterTimestamp,
  });

  // listMessages returns DESC order, reverse to oldest first
  for (const msg of history.reverse()) {
    parts.push({
      role: msg.is_from_me ? 'assistant' : 'user',
      content: formatMessageForLLM(msg, ctx.chatJid),
    });
  }

  return parts;
}
