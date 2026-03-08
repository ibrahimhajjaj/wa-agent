import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { ToolContext } from '../src/tools/types.js';
import type { AgentConfig } from '../src/agent/types.js';

// ---------------------------------------------------------------------------
// Mocks — must be declared before imports that use the mocked modules
// ---------------------------------------------------------------------------

vi.mock('@ibrahimwithi/wu-cli', () => ({
  listMessages: vi.fn().mockReturnValue([]),
}));

vi.mock('../src/memory/store.js', () => ({
  getConversation: vi.fn().mockReturnValue(null),
}));

vi.mock('../src/memory/profiles.js', () => ({
  getUserProfile: vi.fn().mockReturnValue(null),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { buildContext } from '../src/agent/context.js';
import { listMessages } from '@ibrahimwithi/wu-cli';
import { getConversation } from '../src/memory/store.js';
import { getUserProfile } from '../src/memory/profiles.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function minimalAgentConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    name: 'test-agent',
    llm: { provider: 'anthropic', model: 'test' },
    personality: 'You are helpful.',
    tools: [],
    routing: [],
    memory: { conversationWindow: 20, userProfiles: false },
    maxSteps: 10,
    cooldownMs: 5000,
    rateLimitPerWindow: 10,
    ...overrides,
  };
}

function mockToolContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    chatJid: '1234@s.whatsapp.net',
    senderJid: '5678@s.whatsapp.net',
    senderName: 'Test User',
    messageId: 'msg-1',
    agentConfig: minimalAgentConfig(),
    sock: {} as any,
    config: { whatsapp: { send_delay_ms: 1000 } } as any,
    projectConfig: {
      version: 1 as const,
      agents: { dir: './agents' },
      auth: {},
      db: {},
      log: { level: 'info' as const },
      webSearch: { provider: 'tavily' as const },
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset defaults
    vi.mocked(listMessages).mockReturnValue([]);
    vi.mocked(getConversation).mockReturnValue(null);
    vi.mocked(getUserProfile).mockReturnValue(null);
  });

  // ---- 1. No summary, no history ----
  it('returns only system message with personality when no history', () => {
    const config = minimalAgentConfig();
    const ctx = mockToolContext();

    const messages = buildContext(config, ctx);

    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe('system');
    expect((messages[0] as any).content).toBe('You are helpful.');
  });

  // ---- 2. No summary, with history ----
  it('includes user and assistant messages from history', () => {
    vi.mocked(listMessages).mockReturnValue([
      { body: 'newest msg', is_from_me: true, type: 'text', sender_jid: null, sender_name: null, timestamp: 2 },
      { body: 'older msg', is_from_me: false, type: 'text', sender_jid: '5678@s.whatsapp.net', sender_name: 'Alice', timestamp: 1 },
    ] as any);

    const config = minimalAgentConfig();
    const ctx = mockToolContext();
    const messages = buildContext(config, ctx);

    // system + 2 history messages
    expect(messages).toHaveLength(3);
    expect(messages[0].role).toBe('system');
    // After reverse: older first, then newest
    expect(messages[1].role).toBe('user');
    expect(messages[2].role).toBe('assistant');
  });

  // ---- 3. With summary ----
  it('includes summary in system message when conversation has summary', () => {
    vi.mocked(getConversation).mockReturnValue({
      agent_name: 'test-agent',
      chat_jid: '1234@s.whatsapp.net',
      summary: 'User asked about weather.',
      summaryUpToTimestamp: 1000,
    });

    const config = minimalAgentConfig();
    const ctx = mockToolContext();
    const messages = buildContext(config, ctx);

    expect(messages[0].role).toBe('system');
    expect((messages[0] as any).content).toContain('Previous conversation summary:');
    expect((messages[0] as any).content).toContain('User asked about weather.');
  });

  it('passes after timestamp to listMessages when summary exists', () => {
    vi.mocked(getConversation).mockReturnValue({
      agent_name: 'test-agent',
      chat_jid: '1234@s.whatsapp.net',
      summary: 'Some summary',
      summaryUpToTimestamp: 1000,
    });

    const config = minimalAgentConfig();
    const ctx = mockToolContext();
    buildContext(config, ctx);

    expect(listMessages).toHaveBeenCalledWith({
      chatJid: '1234@s.whatsapp.net',
      limit: 20,
      after: 1000,
    });
  });

  // ---- 4. User profile facts ----
  it('includes user profile facts in system message when userProfiles enabled', () => {
    vi.mocked(getUserProfile).mockReturnValue({
      facts: '["Lives in Dubai", "Speaks Arabic"]',
      preferences: '{}',
    });

    const config = minimalAgentConfig({
      memory: { conversationWindow: 20, userProfiles: true },
    });
    const ctx = mockToolContext();
    const messages = buildContext(config, ctx);

    expect((messages[0] as any).content).toContain('Known facts about this user:');
    expect((messages[0] as any).content).toContain('Lives in Dubai');
  });

  it('does not include profile section when userProfiles disabled', () => {
    vi.mocked(getUserProfile).mockReturnValue({
      facts: '["Some fact"]',
      preferences: '{}',
    });

    const config = minimalAgentConfig({
      memory: { conversationWindow: 20, userProfiles: false },
    });
    const ctx = mockToolContext();
    const messages = buildContext(config, ctx);

    expect((messages[0] as any).content).not.toContain('Known facts');
    expect(getUserProfile).not.toHaveBeenCalled();
  });

  it('does not include profile section when senderJid is null', () => {
    vi.mocked(getUserProfile).mockReturnValue({
      facts: '["Fact"]',
      preferences: '{}',
    });

    const config = minimalAgentConfig({
      memory: { conversationWindow: 20, userProfiles: true },
    });
    const ctx = mockToolContext({ senderJid: null });
    const messages = buildContext(config, ctx);

    expect((messages[0] as any).content).not.toContain('Known facts');
    expect(getUserProfile).not.toHaveBeenCalled();
  });

  // ---- 5. Handoff conditions ----
  it('includes handoff conditions in system message when present', () => {
    const config = minimalAgentConfig({
      handoff: {
        enabled: true,
        escalateTo: 'human-agent',
        conditions: ['user is frustrated', 'requests human agent'],
      },
    });
    const ctx = mockToolContext();
    const messages = buildContext(config, ctx);

    expect((messages[0] as any).content).toContain('Escalate to a human when:');
    expect((messages[0] as any).content).toContain('user is frustrated');
    expect((messages[0] as any).content).toContain('requests human agent');
  });

  it('does not include handoff section when no conditions', () => {
    const config = minimalAgentConfig({
      handoff: { enabled: true, escalateTo: 'human-agent' },
    });
    const ctx = mockToolContext();
    const messages = buildContext(config, ctx);

    expect((messages[0] as any).content).not.toContain('Escalate to a human');
  });

  // ---- 6. Message formatting: own → assistant, other → user ----
  it('maps is_from_me to assistant role and others to user role', () => {
    vi.mocked(listMessages).mockReturnValue([
      { body: 'my reply', is_from_me: true, type: 'text', sender_jid: null, sender_name: null, timestamp: 2 },
      { body: 'their question', is_from_me: false, type: 'text', sender_jid: '5678@s.whatsapp.net', sender_name: 'Bob', timestamp: 1 },
    ] as any);

    const config = minimalAgentConfig();
    const ctx = mockToolContext();
    const messages = buildContext(config, ctx);

    // reversed: index 1 = older (user), index 2 = newer (assistant)
    expect(messages[1].role).toBe('user');
    expect(messages[2].role).toBe('assistant');
  });

  // ---- 7. Group messages have sender prefix, DM messages don't ----
  it('prefixes sender name in group chats', () => {
    vi.mocked(listMessages).mockReturnValue([
      { body: 'hello group', is_from_me: false, type: 'text', sender_jid: '5678@s.whatsapp.net', sender_name: 'Alice', timestamp: 1 },
    ] as any);

    const config = minimalAgentConfig();
    const ctx = mockToolContext({ chatJid: 'group-123@g.us' });
    const messages = buildContext(config, ctx);

    expect((messages[1] as any).content).toBe('[Alice]: hello group');
  });

  it('does not prefix sender name in DM chats', () => {
    vi.mocked(listMessages).mockReturnValue([
      { body: 'hello dm', is_from_me: false, type: 'text', sender_jid: '5678@s.whatsapp.net', sender_name: 'Alice', timestamp: 1 },
    ] as any);

    const config = minimalAgentConfig();
    const ctx = mockToolContext({ chatJid: '5678@s.whatsapp.net' });
    const messages = buildContext(config, ctx);

    expect((messages[1] as any).content).toBe('hello dm');
  });

  it('uses sender_jid prefix when sender_name is null in group', () => {
    vi.mocked(listMessages).mockReturnValue([
      { body: 'no name', is_from_me: false, type: 'text', sender_jid: '9999@s.whatsapp.net', sender_name: null, timestamp: 1 },
    ] as any);

    const config = minimalAgentConfig();
    const ctx = mockToolContext({ chatJid: 'group-123@g.us' });
    const messages = buildContext(config, ctx);

    expect((messages[1] as any).content).toBe('[9999]: no name');
  });

  // ---- 8. Messages ordered oldest first ----
  it('reverses listMessages DESC order to oldest first', () => {
    vi.mocked(listMessages).mockReturnValue([
      { body: 'third (newest)', is_from_me: false, type: 'text', sender_jid: '5678@s.whatsapp.net', sender_name: 'A', timestamp: 3 },
      { body: 'second', is_from_me: true, type: 'text', sender_jid: null, sender_name: null, timestamp: 2 },
      { body: 'first (oldest)', is_from_me: false, type: 'text', sender_jid: '5678@s.whatsapp.net', sender_name: 'A', timestamp: 1 },
    ] as any);

    const config = minimalAgentConfig();
    const ctx = mockToolContext();
    const messages = buildContext(config, ctx);

    // messages[0] = system, messages[1..3] = history reversed
    expect((messages[1] as any).content).toBe('first (oldest)');
    expect((messages[2] as any).content).toBe('second');
    expect((messages[3] as any).content).toBe('third (newest)');
  });

  // ---- 9. Non-text message type fallback ----
  it('uses [type] placeholder when body is null', () => {
    vi.mocked(listMessages).mockReturnValue([
      { body: null, is_from_me: false, type: 'image', sender_jid: '5678@s.whatsapp.net', sender_name: 'Bob', timestamp: 1 },
    ] as any);

    const config = minimalAgentConfig();
    const ctx = mockToolContext();
    const messages = buildContext(config, ctx);

    expect((messages[1] as any).content).toBe('[image]');
  });

  // ---- 10. listMessages called with correct params ----
  it('calls listMessages with chatJid and conversationWindow limit', () => {
    const config = minimalAgentConfig({
      memory: { conversationWindow: 50, userProfiles: false },
    });
    const ctx = mockToolContext();
    buildContext(config, ctx);

    expect(listMessages).toHaveBeenCalledWith({
      chatJid: '1234@s.whatsapp.net',
      limit: 50,
      after: undefined,
    });
  });
});
