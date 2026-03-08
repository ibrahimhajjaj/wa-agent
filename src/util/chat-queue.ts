import type { RefCountMap } from '../agent/types.js';

export class ChatQueue {
  private queues = new Map<string, Promise<void>>();

  async enqueue(chatJid: string, fn: () => Promise<void>): Promise<void> {
    const prev = this.queues.get(chatJid) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    this.queues.set(chatJid, next);
    next.finally(() => {
      if (this.queues.get(chatJid) === next) {
        this.queues.delete(chatJid);
      }
    });
    return next;
  }

  async drainForAgent(activeChats: RefCountMap): Promise<void> {
    const pending = activeChats.activeKeys()
      .map(jid => this.queues.get(jid))
      .filter((p): p is Promise<void> => p !== undefined);
    await Promise.allSettled(pending);
  }

  async drainAll(): Promise<void> {
    await Promise.allSettled([...this.queues.values()]);
  }
}
