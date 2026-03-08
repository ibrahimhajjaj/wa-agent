import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// Mock logger before any imports that use it
vi.mock('../src/util/logger.js', () => ({
  logger: {
    child: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  },
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock store
vi.mock('../src/memory/store.js', () => ({
  getDueTasks: vi.fn().mockReturnValue([]),
  deleteScheduledTask: vi.fn(),
  updateTaskNextRun: vi.fn(),
  insertScheduledTask: vi.fn(),
  deleteRecurringTasksForAgent: vi.fn(),
}));

// Mock lifecycle
vi.mock('../src/runtime/lifecycle.js', () => ({
  getAgentInstance: vi.fn().mockReturnValue(null),
}));

// Mock tool registry
vi.mock('../src/tools/registry.js', () => ({
  resolveTools: vi.fn().mockReturnValue({}),
}));

// Mock cron-parser
vi.mock('cron-parser', () => ({
  parseExpression: vi.fn().mockReturnValue({
    next: () => ({ toDate: () => new Date(Date.now() + 60_000) }),
  }),
}));

import { Scheduler } from '../src/triggers/scheduler.js';
import { getDueTasks, deleteScheduledTask, updateTaskNextRun, insertScheduledTask, deleteRecurringTasksForAgent } from '../src/memory/store.js';
import { getAgentInstance } from '../src/runtime/lifecycle.js';
import { resolveTools } from '../src/tools/registry.js';
import type { ScheduledTaskRow } from '../src/memory/store.js';

const mockSock = {} as any;
const mockWuConfig = {} as any;
const mockProjectConfig = {
  version: 1 as const,
  agents: { dir: './agents' },
  auth: {},
  db: {},
  log: { level: 'info' as const },
  webSearch: { provider: 'tavily' as const },
};

function makeTask(overrides: Partial<ScheduledTaskRow> = {}): ScheduledTaskRow {
  return {
    id: 1,
    agent_name: 'test-agent',
    target: '1234@s.whatsapp.net',
    action: 'send-message',
    payload: JSON.stringify({ text: 'Hello!' }),
    next_run_at: Math.floor(Date.now() / 1000) - 10,
    is_recurring: 0,
    cron_expression: null,
    ...overrides,
  };
}

function makeAgentInstance() {
  return {
    config: {
      name: 'test-agent',
      llm: { provider: 'anthropic' as const, model: 'test' },
      personality: 'test',
      tools: [],
      routing: [{ type: 'default' as const, match: '*' }],
      memory: { conversationWindow: 20, userProfiles: true },
      maxSteps: 10,
      cooldownMs: 5000,
      rateLimitPerWindow: 10,
    },
    model: {} as any,
    draining: false,
    activeChats: { increment: vi.fn(), decrement: vi.fn(), has: vi.fn(), activeKeys: vi.fn() },
  };
}

describe('Scheduler', () => {
  let scheduler: Scheduler;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    scheduler = new Scheduler(mockSock, mockWuConfig, mockProjectConfig);
  });

  afterEach(() => {
    scheduler.stop();
    vi.useRealTimers();
  });

  it('start() creates interval and does immediate tick', async () => {
    vi.mocked(getDueTasks).mockReturnValue([]);

    scheduler.start();
    // tick() is called immediately on start
    await vi.advanceTimersByTimeAsync(0);

    expect(getDueTasks).toHaveBeenCalledTimes(1);
  });

  it('stop() clears interval so no more ticks happen', async () => {
    vi.mocked(getDueTasks).mockReturnValue([]);

    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(getDueTasks).toHaveBeenCalledTimes(1);

    scheduler.stop();

    // Advance past multiple intervals — no new ticks should fire
    await vi.advanceTimersByTimeAsync(180_000);
    expect(getDueTasks).toHaveBeenCalledTimes(1);
  });

  it('tick() processes due tasks and executes tool', async () => {
    const mockExecute = vi.fn().mockResolvedValue({ sent: true });

    vi.mocked(getDueTasks).mockReturnValue([makeTask()]);
    vi.mocked(getAgentInstance).mockReturnValue(makeAgentInstance() as any);
    vi.mocked(resolveTools).mockReturnValue({
      'send-message': { execute: mockExecute, description: 'test' } as any,
    });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(mockExecute).toHaveBeenCalledWith(
      { text: 'Hello!' },
      expect.objectContaining({ messages: [], toolCallId: expect.any(String) }),
    );
    expect(deleteScheduledTask).toHaveBeenCalledWith(1);
  });

  it('tick() skips when already ticking (re-entrant guard)', async () => {
    // Use a deferred promise to keep the tick in-flight
    let resolveSlow!: () => void;
    const slowPromise = new Promise<void>((r) => { resolveSlow = r; });
    const slowExecute = vi.fn().mockReturnValue(slowPromise);

    vi.mocked(getDueTasks).mockReturnValue([makeTask()]);
    vi.mocked(getAgentInstance).mockReturnValue(makeAgentInstance() as any);
    vi.mocked(resolveTools).mockReturnValue({
      'send-message': { execute: slowExecute, description: 'test' } as any,
    });

    scheduler.start();
    // First tick starts but doesn't complete because execute hasn't resolved
    await vi.advanceTimersByTimeAsync(0);

    // Advance to the next interval to trigger another tick
    await vi.advanceTimersByTimeAsync(60_000);

    // getDueTasks is called once for the first tick; the second tick is skipped
    // because `ticking` is still true
    expect(getDueTasks).toHaveBeenCalledTimes(1);

    // Let the slow execute complete
    resolveSlow();
    await vi.advanceTimersByTimeAsync(0);
  });

  it('one-shot tasks are deleted after execution', async () => {
    const mockExecute = vi.fn().mockResolvedValue({});

    vi.mocked(getDueTasks).mockReturnValue([
      makeTask({ id: 42, is_recurring: 0, cron_expression: null }),
    ]);
    vi.mocked(getAgentInstance).mockReturnValue(makeAgentInstance() as any);
    vi.mocked(resolveTools).mockReturnValue({
      'send-message': { execute: mockExecute, description: 'test' } as any,
    });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(deleteScheduledTask).toHaveBeenCalledWith(42);
    expect(updateTaskNextRun).not.toHaveBeenCalled();
  });

  it('recurring tasks get next_run_at updated instead of deleted', async () => {
    const mockExecute = vi.fn().mockResolvedValue({});

    vi.mocked(getDueTasks).mockReturnValue([
      makeTask({ id: 7, is_recurring: 1, cron_expression: '0 9 * * *' }),
    ]);
    vi.mocked(getAgentInstance).mockReturnValue(makeAgentInstance() as any);
    vi.mocked(resolveTools).mockReturnValue({
      'send-message': { execute: mockExecute, description: 'test' } as any,
    });

    // Prime the cron parser cache by calling registerTriggers first
    // so the dynamic import resolves before tick() needs it
    await scheduler.registerTriggers({
      name: 'primer',
      triggers: [{ type: 'cron' as const, schedule: '0 0 * * *', action: 'noop', target: 'x' }],
    } as any);
    vi.clearAllMocks();

    // Re-set mocks after clearAllMocks
    vi.mocked(getDueTasks).mockReturnValue([
      makeTask({ id: 7, is_recurring: 1, cron_expression: '0 9 * * *' }),
    ]);
    vi.mocked(getAgentInstance).mockReturnValue(makeAgentInstance() as any);
    vi.mocked(resolveTools).mockReturnValue({
      'send-message': { execute: mockExecute, description: 'test' } as any,
    });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(updateTaskNextRun).toHaveBeenCalledWith(7, expect.any(Number));
    expect(deleteScheduledTask).not.toHaveBeenCalled();
  });

  it('missing agent instance logs warning and skips task', async () => {
    vi.mocked(getDueTasks).mockReturnValue([makeTask()]);
    vi.mocked(getAgentInstance).mockReturnValue(undefined);

    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);

    // Tool should never be resolved or executed
    expect(resolveTools).not.toHaveBeenCalled();
    // Task should not be deleted (it was skipped, not processed)
    expect(deleteScheduledTask).not.toHaveBeenCalled();
  });

  it('registerTriggers deduplicates by deleting existing recurring tasks before insert', async () => {
    const agentConfig = {
      name: 'my-agent',
      llm: { provider: 'anthropic' as const, model: 'test' },
      personality: 'test',
      tools: [],
      routing: [],
      memory: { conversationWindow: 20, userProfiles: true },
      triggers: [
        { type: 'cron' as const, schedule: '0 9 * * *', action: 'send-message', target: '1234@s.whatsapp.net' },
        { type: 'cron' as const, schedule: '0 18 * * *', action: 'send-message', target: '5678@s.whatsapp.net', payload: { text: 'Evening!' } },
      ],
    };

    await scheduler.registerTriggers(agentConfig as any);

    expect(deleteRecurringTasksForAgent).toHaveBeenCalledWith('my-agent');
    expect(insertScheduledTask).toHaveBeenCalledTimes(2);

    // Check first call
    expect(insertScheduledTask).toHaveBeenCalledWith(expect.objectContaining({
      agentName: 'my-agent',
      target: '1234@s.whatsapp.net',
      action: 'send-message',
      isRecurring: 1,
      cronExpression: '0 9 * * *',
    }));

    // Check second call
    expect(insertScheduledTask).toHaveBeenCalledWith(expect.objectContaining({
      agentName: 'my-agent',
      target: '5678@s.whatsapp.net',
      action: 'send-message',
      payload: JSON.stringify({ text: 'Evening!' }),
      isRecurring: 1,
      cronExpression: '0 18 * * *',
    }));
  });

  it('registerTriggers skips non-cron triggers', async () => {
    const agentConfig = {
      name: 'my-agent',
      triggers: [
        { type: 'webhook', schedule: '0 9 * * *', action: 'send-message', target: '1234@s.whatsapp.net' },
      ],
    };

    await scheduler.registerTriggers(agentConfig as any);

    expect(deleteRecurringTasksForAgent).toHaveBeenCalledWith('my-agent');
    expect(insertScheduledTask).not.toHaveBeenCalled();
  });

  it('registerTriggers does nothing when config has no triggers', async () => {
    const agentConfig = {
      name: 'my-agent',
    };

    await scheduler.registerTriggers(agentConfig as any);

    expect(deleteRecurringTasksForAgent).not.toHaveBeenCalled();
    expect(insertScheduledTask).not.toHaveBeenCalled();
  });

  it('updateSock updates the socket reference', () => {
    const newSock = { id: 'new-socket' } as any;
    scheduler.updateSock(newSock);

    // Verify by starting the scheduler and checking the sock is used in context
    // We can verify indirectly: when a task runs, the context should use the new sock
    vi.mocked(getDueTasks).mockReturnValue([makeTask()]);
    vi.mocked(getAgentInstance).mockReturnValue(makeAgentInstance() as any);

    const mockExecute = vi.fn().mockResolvedValue({});
    vi.mocked(resolveTools).mockReturnValue({
      'send-message': { execute: mockExecute, description: 'test' } as any,
    });

    scheduler.start();
    // We can check resolveTools was called with a context containing the new sock
    // but since it's passed as part of ToolContext, we verify via the call args
    return vi.advanceTimersByTimeAsync(0).then(() => {
      expect(resolveTools).toHaveBeenCalledWith(
        ['send-message'],
        expect.objectContaining({ sock: newSock }),
      );
    });
  });

  it('interval triggers tick every 60 seconds', async () => {
    vi.mocked(getDueTasks).mockReturnValue([]);

    scheduler.start();
    await vi.advanceTimersByTimeAsync(0); // flush first tick

    expect(getDueTasks).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(getDueTasks).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(getDueTasks).toHaveBeenCalledTimes(3);
  });

  it('tool execution failure does not prevent task cleanup', async () => {
    const mockExecute = vi.fn().mockRejectedValue(new Error('tool failed'));

    vi.mocked(getDueTasks).mockReturnValue([makeTask({ id: 99 })]);
    vi.mocked(getAgentInstance).mockReturnValue(makeAgentInstance() as any);
    vi.mocked(resolveTools).mockReturnValue({
      'send-message': { execute: mockExecute, description: 'test' } as any,
    });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);

    // Even though tool threw, the one-shot task should still be deleted
    expect(deleteScheduledTask).toHaveBeenCalledWith(99);
  });

  it('task with no payload passes empty object to tool', async () => {
    const mockExecute = vi.fn().mockResolvedValue({});

    vi.mocked(getDueTasks).mockReturnValue([makeTask({ payload: null })]);
    vi.mocked(getAgentInstance).mockReturnValue(makeAgentInstance() as any);
    vi.mocked(resolveTools).mockReturnValue({
      'send-message': { execute: mockExecute, description: 'test' } as any,
    });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(mockExecute).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ messages: [], toolCallId: expect.any(String) }),
    );
  });
});
