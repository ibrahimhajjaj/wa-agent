import { generateText } from 'ai';
import { listMessages } from '@ibrahimwithi/wu-cli';
import type { AgentInstance } from '../agent/types.js';
import { getConversation, upsertConversation } from './store.js';
import { getFilteredMessageCount } from '@ibrahimwithi/wu-cli';
import { createChildLogger } from '../util/logger.js';

const logger = createChildLogger('summarizer');

const SUMMARIZE_PROMPT = `Summarize this conversation concisely. Include:
- Key topics discussed
- Decisions made
- Action items or pending questions
- Important facts about participants

Keep it under 500 words. Be factual, not interpretive.`;

export async function maybeTriggerSummarization(
  agent: AgentInstance,
  chatJid: string,
): Promise<void> {
  const config = agent.config;
  if (!config.memory.summarizeAfter) return;

  const convo = getConversation(config.name, chatJid);
  const afterTimestamp = convo?.summaryUpToTimestamp ?? undefined;

  // Count messages since last summary
  const msgCount = getFilteredMessageCount({
    chatJid,
    after: afterTimestamp,
  });

  if (msgCount < config.memory.summarizeAfter) return;

  logger.info({ agent: config.name, chatJid, msgCount }, 'Triggering summarization');

  // Get messages to summarize — fetch a larger window so we can pick the oldest batch.
  // listMessages returns DESC (newest first), so we reverse to get ASC (oldest first)
  // and then take only the first `summarizeAfter` messages (the oldest unsummarized ones).
  const allSince = listMessages({
    chatJid,
    limit: config.memory.summarizeAfter * 2,
    after: afterTimestamp,
  });

  if (allSince.length === 0) return;

  // Reverse to ASC (oldest first), then take the oldest batch
  const ascMessages = allSince.reverse();
  const messages = ascMessages.slice(0, config.memory.summarizeAfter);

  const conversationText = messages
    .map(m => {
      const sender = m.is_from_me ? 'Agent' : (m.sender_name || m.sender_jid || 'User');
      return `${sender}: ${m.body || `[${m.type}]`}`;
    })
    .join('\n');

  const existingSummary = convo?.summary ? `Previous summary:\n${convo.summary}\n\n` : '';

  const result = await generateText({
    model: agent.model,
    messages: [
      {
        role: 'system',
        content: SUMMARIZE_PROMPT,
      },
      {
        role: 'user',
        content: `${existingSummary}New conversation:\n${conversationText}`,
      },
    ],
  });

  // Use the latest message timestamp as the summary point
  const latestTimestamp = messages[messages.length - 1]?.timestamp ?? Math.floor(Date.now() / 1000);

  upsertConversation(config.name, chatJid, result.text, latestTimestamp);
  logger.info({ agent: config.name, chatJid }, 'Summarization complete');
}
