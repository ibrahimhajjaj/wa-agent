import { createChildLogger } from '../util/logger.js';

const logger = createChildLogger('rate-limit');

export class RateLimiter {
  private timestamps = new Map<string, number[]>();
  private windowMs: number;

  constructor(windowMs: number = 5 * 60 * 1000) {
    this.windowMs = windowMs;
  }

  /** Check if a request is allowed. Returns true if under limit. */
  check(chatJid: string, maxPerWindow: number): boolean {
    const now = Date.now();
    let times = this.timestamps.get(chatJid);

    if (!times) {
      times = [];
      this.timestamps.set(chatJid, times);
    }

    // Remove timestamps outside the window
    const cutoff = now - this.windowMs;
    while (times.length > 0 && times[0] <= cutoff) {
      times.shift();
    }

    if (times.length >= maxPerWindow) {
      logger.debug({ chatJid, maxPerWindow, current: times.length }, 'Rate limit hit');
      return false;
    }

    times.push(now);
    return true;
  }
}
