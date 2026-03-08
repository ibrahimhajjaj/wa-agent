import { generateText, stepCountIs, NoSuchToolError, InvalidToolInputError } from 'ai';
import { sendText, sendTypingIndicator } from '@ibrahimwithi/wu-cli';
import type { AgentInstance } from './types.js';
import type { ToolContext } from '../tools/types.js';
import type { ParsedMessage } from '@ibrahimwithi/wu-cli';
import { buildContext } from './context.js';
import { resolveTools } from '../tools/registry.js';
import { maybeTriggerSummarization } from '../memory/summarizer.js';
import { maybeUpdateUserProfile } from '../memory/profiles.js';
import { createChildLogger } from '../util/logger.js';

const logger = createChildLogger('agent');

export async function handleMessage(
  agent: AgentInstance,
  _msg: ParsedMessage,
  ctx: ToolContext,
): Promise<void> {
  // 1. Show typing indicator
  await sendTypingIndicator(ctx.sock, ctx.chatJid, true);

  try {
    const messages = buildContext(agent.config, ctx);
    const tools = resolveTools(agent.config.tools, ctx);

    const result = await generateText({
      model: agent.model,
      messages,
      tools,
      stopWhen: stepCountIs(agent.config.maxSteps ?? 10),
      temperature: agent.config.llm.temperature,
      maxOutputTokens: agent.config.llm.maxTokens,
      onStepFinish: async () => {
        await sendTypingIndicator(ctx.sock, ctx.chatJid, true).catch(() => {});
      },
    });

    // 2. Handle maxSteps exhaustion
    if (result.finishReason === 'tool-calls') {
      logger.warn({ agent: agent.config.name, steps: result.steps.length }, 'Agent hit maxSteps limit');
      await sendText(
        ctx.sock,
        ctx.chatJid,
        "I may not have fully completed that — the request was complex. Let me know if anything's missing.",
        ctx.config,
      );
    }

    // 3. If the agent produced text and didn't already send via tool, send the response
    if (result.text && result.finishReason !== 'tool-calls') {
      await sendText(ctx.sock, ctx.chatJid, result.text, ctx.config);
    }

    // 4. Background: update user profile + check summarization
    if (agent.config.memory.userProfiles && ctx.senderJid) {
      maybeUpdateUserProfile(agent, ctx.senderJid, result).catch(err =>
        logger.error({ err }, 'Failed to update user profile'),
      );
    }
    maybeTriggerSummarization(agent, ctx.chatJid).catch(err =>
      logger.error({ err }, 'Failed to trigger summarization'),
    );
  } catch (err) {
    // 5. Error recovery
    logger.error({ err, agent: agent.config.name, chatJid: ctx.chatJid }, 'Agent error');

    if (NoSuchToolError.isInstance(err)) {
      logger.warn({ err }, 'Tool not found error');
    } else if (InvalidToolInputError.isInstance(err)) {
      logger.warn({ err }, 'Invalid tool input error');
    }

    try {
      await sendText(ctx.sock, ctx.chatJid, 'Sorry, I ran into an issue. Please try again.', ctx.config);
    } catch (sendErr) {
      logger.error({ sendErr }, 'Failed to send fallback message');
    }
  } finally {
    // 6. Always clear typing indicator
    await sendTypingIndicator(ctx.sock, ctx.chatJid, false).catch(() => {});
  }
}
