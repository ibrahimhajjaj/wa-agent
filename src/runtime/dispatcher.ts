import type { ParsedMessage } from '@ibrahimwithi/wu-cli';
import type { WASocket } from '@whiskeysockets/baileys';
import type { AgentInstance } from '../agent/types.js';
import type { ToolContext } from '../tools/types.js';
import type { WuConfig } from '@ibrahimwithi/wu-cli';
import type { ProjectConfig } from '../config/schema.js';
import { handleMessage } from '../agent/agent.js';
import { ChatQueue } from '../util/chat-queue.js';
import { CooldownTracker } from '../middleware/cooldown.js';
import { RateLimiter } from '../middleware/rate-limit.js';
import { createChildLogger } from '../util/logger.js';

const logger = createChildLogger('dispatcher');

export class Dispatcher {
  private chatQueue = new ChatQueue();
  private cooldown = new CooldownTracker();
  private rateLimiter = new RateLimiter();

  constructor(
    private sock: WASocket,
    private wuConfig: WuConfig,
    private projectConfig: ProjectConfig,
  ) {}

  async dispatch(msg: ParsedMessage, agent: AgentInstance): Promise<void> {
    // Per-agent cooldown check
    if (!this.cooldown.check(msg.chatJid, agent.config.cooldownMs ?? 5000)) {
      logger.debug({ chatJid: msg.chatJid, agent: agent.config.name }, 'Cooldown active, skipping');
      return;
    }

    // Per-agent rate limit check
    if (!this.rateLimiter.check(msg.chatJid, agent.config.rateLimitPerWindow ?? 10)) {
      logger.debug({ chatJid: msg.chatJid, agent: agent.config.name }, 'Rate limited, skipping');
      return;
    }

    agent.activeChats.increment(msg.chatJid);

    this.chatQueue.enqueue(msg.chatJid, async () => {
      try {
        const ctx: ToolContext = {
          chatJid: msg.chatJid,
          senderJid: msg.senderJid,
          senderName: msg.senderName,
          messageId: msg.id,
          agentConfig: agent.config,
          sock: this.sock,
          config: this.wuConfig,
          projectConfig: this.projectConfig,
        };

        await handleMessage(agent, msg, ctx);
        this.cooldown.recordResponse(msg.chatJid);
      } catch (err) {
        logger.error({ err, agent: agent.config.name, chatJid: msg.chatJid }, 'Dispatch error');
      } finally {
        agent.activeChats.decrement(msg.chatJid);
      }
    });
  }

  updateSock(sock: WASocket): void {
    this.sock = sock;
  }

  getChatQueue(): ChatQueue {
    return this.chatQueue;
  }
}
