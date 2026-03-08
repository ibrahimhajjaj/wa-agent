import { describe, it, expect, beforeEach } from 'vitest';
import { resolveTools, registerCustomTool } from '../src/tools/registry.js';
import { defineTool } from '../src/tools/types.js';
import { tool } from 'ai';
import { z } from 'zod';
import type { ToolContext } from '../src/tools/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockToolContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    chatJid: '1234@s.whatsapp.net',
    senderJid: '5678@s.whatsapp.net',
    senderName: 'Test User',
    messageId: 'msg-1',
    agentConfig: {
      name: 'test-agent',
      llm: { provider: 'anthropic', model: 'test' },
      personality: 'test',
      tools: [],
      routing: [],
      memory: { conversationWindow: 20, userProfiles: true },
      maxSteps: 10,
      cooldownMs: 5000,
      rateLimitPerWindow: 10,
    } as any,
    sock: {} as any,
    config: { whatsapp: { send_delay_ms: 1000 } } as any,
    projectConfig: {
      version: 1 as const,
      agents: { dir: './agents' },
      auth: {},
      db: {},
      log: { level: 'info' as const },
      webSearch: { provider: 'tavily' as const },
      fetchUrl: { provider: 'jina' as const },
    },
    ...overrides,
  };
}

const BUILTIN_TOOL_NAMES = [
  'send-message',
  'search-messages',
  'get-chat-history',
  'send-reaction',
  'web-search',
  'fetch-url',
  'schedule',
  'handoff',
] as const;

// ---------------------------------------------------------------------------
// 1. resolveTools
// ---------------------------------------------------------------------------

describe('resolveTools', () => {
  it('returns correct tools for valid builtin names', () => {
    const ctx = mockToolContext();
    const tools = resolveTools(['send-message', 'handoff'], ctx);

    expect(Object.keys(tools)).toEqual(['send-message', 'handoff']);
    expect(tools['send-message']).toBeDefined();
    expect(tools['handoff']).toBeDefined();
  });

  it('returns objects with execute property', () => {
    const ctx = mockToolContext();
    const tools = resolveTools(['send-message'], ctx);
    // ai SDK tools have an execute function
    expect(tools['send-message']).toHaveProperty('execute');
    expect(typeof (tools['send-message'] as any).execute).toBe('function');
  });

  it('throws for unknown tool names', () => {
    const ctx = mockToolContext();
    expect(() => resolveTools(['nonexistent-tool'], ctx)).toThrow('Unknown tool: nonexistent-tool');
  });

  it('throws for a mix of valid and unknown tool names', () => {
    const ctx = mockToolContext();
    expect(() => resolveTools(['send-message', 'does-not-exist'], ctx)).toThrow(
      'Unknown tool: does-not-exist',
    );
  });

  it('returns empty object for empty tool list', () => {
    const ctx = mockToolContext();
    const tools = resolveTools([], ctx);
    expect(tools).toEqual({});
  });

  it('returns tools keyed by their names', () => {
    const ctx = mockToolContext();
    const names = ['send-message', 'web-search', 'fetch-url'];
    const tools = resolveTools(names, ctx);
    expect(Object.keys(tools).sort()).toEqual([...names].sort());
  });
});

// ---------------------------------------------------------------------------
// 2. All 8 builtin tools registered
// ---------------------------------------------------------------------------

describe('builtin tools', () => {
  it('all 8 builtin tools are resolvable', () => {
    const ctx = mockToolContext();
    const tools = resolveTools([...BUILTIN_TOOL_NAMES], ctx);
    expect(Object.keys(tools)).toHaveLength(8);
    for (const name of BUILTIN_TOOL_NAMES) {
      expect(tools[name]).toBeDefined();
    }
  });

  it.each(BUILTIN_TOOL_NAMES)('%s has an execute function', (name) => {
    const ctx = mockToolContext();
    const tools = resolveTools([name], ctx);
    expect(typeof (tools[name] as any).execute).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// 3. registerCustomTool
// ---------------------------------------------------------------------------

describe('registerCustomTool', () => {
  it('makes a custom tool available via resolveTools', () => {
    const factory = (ctx: ToolContext) =>
      tool({
        description: 'Custom test tool',
        inputSchema: z.object({ value: z.string() }),
        execute: async ({ value }) => ({ echo: value }),
      });

    registerCustomTool('my-custom-tool', factory);

    const ctx = mockToolContext();
    const tools = resolveTools(['my-custom-tool'], ctx);
    expect(tools['my-custom-tool']).toBeDefined();
    expect(typeof (tools['my-custom-tool'] as any).execute).toBe('function');
  });

  it('custom tool can be resolved alongside builtin tools', () => {
    const factory = (ctx: ToolContext) =>
      tool({
        description: 'Another custom tool',
        inputSchema: z.object({}),
        execute: async () => ({ ok: true }),
      });

    registerCustomTool('another-custom', factory);

    const ctx = mockToolContext();
    const tools = resolveTools(['send-message', 'another-custom'], ctx);
    expect(Object.keys(tools)).toEqual(['send-message', 'another-custom']);
  });

  it('overwriting a custom tool replaces it', () => {
    const factory1 = (ctx: ToolContext) =>
      tool({
        description: 'Version 1',
        inputSchema: z.object({}),
        execute: async () => ({ v: 1 }),
      });
    const factory2 = (ctx: ToolContext) =>
      tool({
        description: 'Version 2',
        inputSchema: z.object({}),
        execute: async () => ({ v: 2 }),
      });

    registerCustomTool('overwrite-me', factory1);
    registerCustomTool('overwrite-me', factory2);

    const ctx = mockToolContext();
    const tools = resolveTools(['overwrite-me'], ctx);
    // The second registration should win
    expect((tools['overwrite-me'] as any).description).toBe('Version 2');
  });
});

// ---------------------------------------------------------------------------
// 4. defineTool helper
// ---------------------------------------------------------------------------

describe('defineTool', () => {
  it('creates a tool factory from defineTool', () => {
    const myTool = defineTool({
      description: 'Test tool',
      inputSchema: z.object({ name: z.string() }),
      execute: async (input, ctx) => {
        return { greeting: `Hello ${input.name} from ${ctx.chatJid}` };
      },
    });

    const ctx = mockToolContext();
    const resolved = myTool(ctx);
    expect(resolved).toBeDefined();
    expect((resolved as any).description).toBe('Test tool');
  });

  it('resolved tool has execute function', () => {
    const myTool = defineTool({
      description: 'Exec check',
      inputSchema: z.object({ x: z.number() }),
      execute: async (input, ctx) => ({ doubled: input.x * 2 }),
    });

    const ctx = mockToolContext();
    const resolved = myTool(ctx);
    expect(typeof (resolved as any).execute).toBe('function');
  });

  it('defineTool factory can be registered as custom tool', () => {
    const myTool = defineTool({
      description: 'Registerable tool',
      inputSchema: z.object({}),
      execute: async (_input, ctx) => ({ jid: ctx.chatJid }),
    });

    registerCustomTool('defined-tool', myTool);

    const ctx = mockToolContext();
    const tools = resolveTools(['defined-tool'], ctx);
    expect(tools['defined-tool']).toBeDefined();
  });
});
