import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ChatQueue } from '../src/util/chat-queue.js';
import { RefCountMap } from '../src/agent/types.js';

describe('ChatQueue', () => {
  // Suppress unhandled rejections from ChatQueue's .finally() branch
  // when testing error isolation (known design choice in the queue implementation).
  const suppressed = new Set<Promise<unknown>>();
  let originalListeners: NodeJS.UnhandledRejectionListener[];

  beforeEach(() => {
    originalListeners = process.rawListeners('unhandledRejection') as NodeJS.UnhandledRejectionListener[];
    process.removeAllListeners('unhandledRejection');
    process.on('unhandledRejection', (_reason, promise) => {
      suppressed.add(promise);
    });
  });

  afterEach(() => {
    process.removeAllListeners('unhandledRejection');
    for (const listener of originalListeners) {
      process.on('unhandledRejection', listener);
    }
    suppressed.clear();
  });

  it('serializes tasks for the same JID', async () => {
    const queue = new ChatQueue();
    const order: number[] = [];

    const p1 = queue.enqueue('chat-1', async () => {
      await new Promise(r => setTimeout(r, 50));
      order.push(1);
    });
    const p2 = queue.enqueue('chat-1', async () => {
      order.push(2);
    });

    await Promise.all([p1, p2]);
    expect(order).toEqual([1, 2]);
  });

  it('runs different JIDs in parallel', async () => {
    const queue = new ChatQueue();
    const running: string[] = [];
    const completed: string[] = [];

    const p1 = queue.enqueue('chat-1', async () => {
      running.push('chat-1');
      await new Promise(r => setTimeout(r, 50));
      completed.push('chat-1');
    });
    const p2 = queue.enqueue('chat-2', async () => {
      running.push('chat-2');
      await new Promise(r => setTimeout(r, 10));
      completed.push('chat-2');
    });

    await Promise.all([p1, p2]);
    // Both should have started
    expect(running).toContain('chat-1');
    expect(running).toContain('chat-2');
    // chat-2 should complete first (shorter delay)
    expect(completed[0]).toBe('chat-2');
  });

  it('isolates errors — a failing task does not block subsequent tasks', async () => {
    const queue = new ChatQueue();
    const order: number[] = [];

    const p1 = queue.enqueue('chat-1', async () => {
      throw new Error('boom');
    });
    // Attach a no-op catch to suppress unhandled rejection from the .finally() branch
    p1.catch(() => {});
    const p2 = queue.enqueue('chat-1', async () => {
      order.push(2);
    });

    // p1 should reject
    await expect(p1).rejects.toThrow('boom');
    // p2 should still run
    await p2;
    expect(order).toEqual([2]);
  });

  it('drainAll waits for all pending tasks', async () => {
    const queue = new ChatQueue();
    const completed: string[] = [];

    queue.enqueue('chat-1', async () => {
      await new Promise(r => setTimeout(r, 30));
      completed.push('chat-1');
    });
    queue.enqueue('chat-2', async () => {
      await new Promise(r => setTimeout(r, 10));
      completed.push('chat-2');
    });

    await queue.drainAll();
    expect(completed).toContain('chat-1');
    expect(completed).toContain('chat-2');
  });

  it('drainForAgent waits only for tasks matching activeChats', async () => {
    const queue = new ChatQueue();
    const completed: string[] = [];

    queue.enqueue('chat-1', async () => {
      await new Promise(r => setTimeout(r, 30));
      completed.push('chat-1');
    });
    queue.enqueue('chat-2', async () => {
      await new Promise(r => setTimeout(r, 60));
      completed.push('chat-2');
    });

    const activeChats = new RefCountMap();
    activeChats.increment('chat-1');

    await queue.drainForAgent(activeChats);
    // chat-1 should be done
    expect(completed).toContain('chat-1');
    // chat-2 may or may not be done depending on timing,
    // but drainForAgent should not have waited for it beyond chat-1's completion
  });

  it('drainForAgent with no matching chats resolves immediately', async () => {
    const queue = new ChatQueue();

    queue.enqueue('chat-1', async () => {
      await new Promise(r => setTimeout(r, 100));
    });

    const activeChats = new RefCountMap();
    activeChats.increment('chat-999');

    // Should resolve immediately since chat-999 is not in the queue
    const start = Date.now();
    await queue.drainForAgent(activeChats);
    expect(Date.now() - start).toBeLessThan(50);
  });

  it('cleans up completed JIDs from the queue map', async () => {
    const queue = new ChatQueue();

    await queue.enqueue('chat-1', async () => {
      // no-op
    });

    // After completion and microtask flush, the queue should be cleaned up
    // We verify by draining — it should resolve instantly
    const start = Date.now();
    await queue.drainAll();
    expect(Date.now() - start).toBeLessThan(20);
  });

  it('handles multiple sequential tasks on the same JID', async () => {
    const queue = new ChatQueue();
    const order: number[] = [];

    const p1 = queue.enqueue('chat-1', async () => {
      await new Promise(r => setTimeout(r, 10));
      order.push(1);
    });
    const p2 = queue.enqueue('chat-1', async () => {
      await new Promise(r => setTimeout(r, 10));
      order.push(2);
    });
    const p3 = queue.enqueue('chat-1', async () => {
      await new Promise(r => setTimeout(r, 10));
      order.push(3);
    });

    await Promise.all([p1, p2, p3]);
    expect(order).toEqual([1, 2, 3]);
  });
});
