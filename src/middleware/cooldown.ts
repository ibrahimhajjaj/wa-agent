import { createChildLogger } from '../util/logger.js';

const logger = createChildLogger('cooldown');

export class CooldownTracker {
  private lastResponseTime = new Map<string, number>();

  /** Check if a chat is in cooldown. Returns true if OK to proceed. */
  check(chatJid: string, cooldownMs: number): boolean {
    const now = Date.now();
    const lastTime = this.lastResponseTime.get(chatJid);
    if (lastTime && now - lastTime < cooldownMs) {
      logger.debug({ chatJid, cooldownMs, elapsed: now - lastTime }, 'Cooldown active');
      return false;
    }
    return true;
  }

  /** Record that we responded to a chat */
  recordResponse(chatJid: string): void {
    this.lastResponseTime.set(chatJid, Date.now());
  }
}
