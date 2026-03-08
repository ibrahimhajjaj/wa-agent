import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ParsedMessage } from '@ibrahimwithi/wu-cli';
import { MiddlewarePipeline, type MiddlewareFn } from '../src/middleware/pipeline.js';
import { createFilterMiddleware } from '../src/middleware/filter.js';
import { CooldownTracker } from '../src/middleware/cooldown.js';
import { RateLimiter } from '../src/middleware/rate-limit.js';

// Mock the store module before importing handoff-check
vi.mock('../src/memory/store.js', () => ({
  getHandoffState: vi.fn().mockReturnValue(false),
}));

import { createHandoffCheckMiddleware } from '../src/middleware/handoff-check.js';
import { getHandoffState } from '../src/memory/store.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockMessage(overrides: Partial<ParsedMessage> = {}): ParsedMessage {
  return {
    id: 'msg-001',
    chatJid: '1234567890@s.whatsapp.net',
    senderJid: '1234567890@s.whatsapp.net',
    senderName: 'Test User',
    body: 'Hello there',
    type: 'text',
    isFromMe: false,
    timestamp: Math.floor(Date.now() / 1000),
    mediaMime: null,
    mediaSize: null,
    quotedId: null,
    raw: {} as any,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// MiddlewarePipeline
// ---------------------------------------------------------------------------

describe('MiddlewarePipeline', () => {
  it('empty pipeline passes all messages', () => {
    const pipeline = new MiddlewarePipeline();
    expect(pipeline.run(mockMessage())).toBe(true);
  });

  it('single middleware that returns true passes', () => {
    const pipeline = new MiddlewarePipeline();
    pipeline.use('allow-all', () => true);
    expect(pipeline.run(mockMessage())).toBe(true);
  });

  it('single middleware that returns false rejects', () => {
    const pipeline = new MiddlewarePipeline();
    pipeline.use('deny-all', () => false);
    expect(pipeline.run(mockMessage())).toBe(false);
  });

  it('multiple middlewares — all must pass', () => {
    const pipeline = new MiddlewarePipeline();
    pipeline.use('first', () => true);
    pipeline.use('second', () => true);
    pipeline.use('third', () => true);
    expect(pipeline.run(mockMessage())).toBe(true);
  });

  it('first failing middleware short-circuits (later ones not called)', () => {
    const pipeline = new MiddlewarePipeline();
    const first = vi.fn(() => true);
    const second = vi.fn(() => false);
    const third = vi.fn(() => true);

    pipeline.use('first', first);
    pipeline.use('second', second);
    pipeline.use('third', third);

    const result = pipeline.run(mockMessage());

    expect(result).toBe(false);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(third).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Filter middleware
// ---------------------------------------------------------------------------

describe('createFilterMiddleware', () => {
  let filter: MiddlewareFn;

  beforeEach(() => {
    filter = createFilterMiddleware();
  });

  it('rejects own messages (isFromMe: true)', () => {
    expect(filter(mockMessage({ isFromMe: true }))).toBe(false);
  });

  it('rejects status broadcasts (chatJid: status@broadcast)', () => {
    expect(filter(mockMessage({ chatJid: 'status@broadcast' }))).toBe(false);
  });

  it('rejects broadcast JIDs (chatJid ending in @broadcast)', () => {
    expect(filter(mockMessage({ chatJid: '120363xxx@broadcast' }))).toBe(false);
  });

  it('rejects empty messages (body: null, type: unknown)', () => {
    expect(filter(mockMessage({ body: null, type: 'unknown' }))).toBe(false);
  });

  it('passes normal incoming text messages', () => {
    expect(filter(mockMessage())).toBe(true);
  });

  it('passes incoming media messages (body: null but type: image)', () => {
    expect(filter(mockMessage({ body: null, type: 'image' }))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// CooldownTracker
// ---------------------------------------------------------------------------

describe('CooldownTracker', () => {
  let tracker: CooldownTracker;
  const cooldownMs = 5000;
  const chatJid = 'user-a@s.whatsapp.net';

  beforeEach(() => {
    vi.useFakeTimers();
    tracker = new CooldownTracker();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('first message always passes (no prior response)', () => {
    expect(tracker.check(chatJid, cooldownMs)).toBe(true);
  });

  it('message within cooldown period is rejected', () => {
    tracker.recordResponse(chatJid);
    vi.advanceTimersByTime(2000); // 2s < 5s cooldown
    expect(tracker.check(chatJid, cooldownMs)).toBe(false);
  });

  it('message after cooldown period passes', () => {
    tracker.recordResponse(chatJid);
    vi.advanceTimersByTime(5001); // just past cooldown
    expect(tracker.check(chatJid, cooldownMs)).toBe(true);
  });

  it('different chats have independent cooldowns', () => {
    const chatB = 'user-b@s.whatsapp.net';
    tracker.recordResponse(chatJid);
    vi.advanceTimersByTime(2000);

    // chatJid in cooldown, chatB is not
    expect(tracker.check(chatJid, cooldownMs)).toBe(false);
    expect(tracker.check(chatB, cooldownMs)).toBe(true);
  });

  it('recordResponse() resets the cooldown timer', () => {
    tracker.recordResponse(chatJid);
    vi.advanceTimersByTime(4000); // 4s elapsed

    // Record a new response — timer resets
    tracker.recordResponse(chatJid);
    vi.advanceTimersByTime(2000); // only 2s since reset

    expect(tracker.check(chatJid, cooldownMs)).toBe(false);

    vi.advanceTimersByTime(3001); // now 5001ms since reset
    expect(tracker.check(chatJid, cooldownMs)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// RateLimiter
// ---------------------------------------------------------------------------

describe('RateLimiter', () => {
  const windowMs = 60_000; // 1 minute window
  const maxPerWindow = 3;
  const chatJid = 'user-a@s.whatsapp.net';

  let limiter: RateLimiter;

  beforeEach(() => {
    vi.useFakeTimers();
    limiter = new RateLimiter(windowMs);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('first N messages pass (up to maxPerWindow)', () => {
    expect(limiter.check(chatJid, maxPerWindow)).toBe(true);
    expect(limiter.check(chatJid, maxPerWindow)).toBe(true);
    expect(limiter.check(chatJid, maxPerWindow)).toBe(true);
  });

  it('message N+1 is rejected', () => {
    for (let i = 0; i < maxPerWindow; i++) {
      limiter.check(chatJid, maxPerWindow);
    }
    expect(limiter.check(chatJid, maxPerWindow)).toBe(false);
  });

  it('different chats have independent limits', () => {
    const chatB = 'user-b@s.whatsapp.net';

    // Exhaust limit for chatJid
    for (let i = 0; i < maxPerWindow; i++) {
      limiter.check(chatJid, maxPerWindow);
    }

    // chatB should still be fine
    expect(limiter.check(chatB, maxPerWindow)).toBe(true);
    // chatJid should be blocked
    expect(limiter.check(chatJid, maxPerWindow)).toBe(false);
  });

  it('after window expires, messages pass again', () => {
    // Exhaust limit
    for (let i = 0; i < maxPerWindow; i++) {
      limiter.check(chatJid, maxPerWindow);
    }
    expect(limiter.check(chatJid, maxPerWindow)).toBe(false);

    // Advance past the window
    vi.advanceTimersByTime(windowMs + 1);

    expect(limiter.check(chatJid, maxPerWindow)).toBe(true);
  });

  it('sliding window: old timestamps fall off', () => {
    // Send 2 messages at t=0
    limiter.check(chatJid, maxPerWindow);
    limiter.check(chatJid, maxPerWindow);

    // Advance 40s, send 1 more (total 3 in window)
    vi.advanceTimersByTime(40_000);
    expect(limiter.check(chatJid, maxPerWindow)).toBe(true);

    // Now at limit — 4th should fail
    expect(limiter.check(chatJid, maxPerWindow)).toBe(false);

    // Advance 21s more (total 61s since first 2 messages) — they fall off
    vi.advanceTimersByTime(21_000);

    // Now only 1 message in window (the one at t=40s), so new ones pass
    expect(limiter.check(chatJid, maxPerWindow)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Handoff-check middleware
// ---------------------------------------------------------------------------

describe('createHandoffCheckMiddleware', () => {
  let middleware: MiddlewareFn;

  beforeEach(() => {
    vi.mocked(getHandoffState).mockReset().mockReturnValue(false);
    middleware = createHandoffCheckMiddleware(() => ['agent-1']);
  });

  it('passes messages when chat is not handed off', () => {
    const msg = mockMessage({ chatJid: 'normal@s.whatsapp.net' });
    expect(middleware(msg)).toBe(true);
    expect(getHandoffState).toHaveBeenCalledWith('agent-1', 'normal@s.whatsapp.net');
  });

  it('rejects messages from handed-off chats', () => {
    vi.mocked(getHandoffState).mockReturnValue(true);
    const msg = mockMessage({ chatJid: 'handed-off@s.whatsapp.net' });
    expect(middleware(msg)).toBe(false);
  });

  it('checks all agent names and rejects if any has handoff', () => {
    middleware = createHandoffCheckMiddleware(() => ['agent-1', 'agent-2']);
    vi.mocked(getHandoffState).mockImplementation(
      (agentName: string, _chatJid: string) => agentName === 'agent-2',
    );

    const msg = mockMessage({ chatJid: 'some-chat@s.whatsapp.net' });
    expect(middleware(msg)).toBe(false);
  });

  it('passes when no agents have the chat handed off', () => {
    middleware = createHandoffCheckMiddleware(() => ['agent-1', 'agent-2']);
    const msg = mockMessage({ chatJid: 'free-chat@s.whatsapp.net' });
    expect(middleware(msg)).toBe(true);
    expect(getHandoffState).toHaveBeenCalledTimes(2);
  });
});
