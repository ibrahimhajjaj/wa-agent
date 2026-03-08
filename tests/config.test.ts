import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AgentConfigSchema, ProjectConfigSchema } from '../src/config/schema.js';
import { loadProjectConfig, loadAgentConfig, loadAllAgentConfigs } from '../src/config/loader.js';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { stringify as toYaml } from 'yaml';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function minimalAgentInput() {
  return {
    name: 'test-bot',
    llm: { provider: 'anthropic' as const, model: 'claude-sonnet-4-20250514' },
    personality: 'You are helpful.',
  };
}

function fullAgentInput() {
  return {
    name: 'full-bot',
    description: 'A fully configured bot',
    llm: { provider: 'openai' as const, model: 'gpt-4o', temperature: 0.7, maxTokens: 2048, baseUrl: 'https://api.openai.com' },
    personality: 'You are an expert assistant.',
    tools: ['web-search', 'calculator'],
    routing: [
      { type: 'keyword' as const, match: 'help', priority: 1 },
      { type: 'default' as const, match: '*' },
    ],
    memory: { conversationWindow: 50, summarizeAfter: 100, userProfiles: false },
    triggers: [{ type: 'cron' as const, schedule: '0 9 * * *', action: 'greet', target: '1234@s.whatsapp.net' }],
    handoff: { enabled: true, escalateTo: 'human-agent', conditions: ['frustrated'] },
    maxSteps: 20,
    cooldownMs: 10000,
    rateLimitPerWindow: 5,
  };
}

// ---------------------------------------------------------------------------
// 1. AgentConfigSchema validation
// ---------------------------------------------------------------------------

describe('AgentConfigSchema', () => {
  it('parses minimal valid config with defaults', () => {
    const result = AgentConfigSchema.parse(minimalAgentInput());
    expect(result.name).toBe('test-bot');
    expect(result.llm.provider).toBe('anthropic');
    expect(result.personality).toBe('You are helpful.');
    expect(result.memory.conversationWindow).toBe(20);
    expect(result.memory.userProfiles).toBe(true);
    expect(result.maxSteps).toBe(10);
    expect(result.cooldownMs).toBe(5000);
    expect(result.rateLimitPerWindow).toBe(10);
    expect(result.tools).toEqual([]);
    expect(result.routing).toEqual([]);
  });

  it('parses full config with all fields', () => {
    const input = fullAgentInput();
    const result = AgentConfigSchema.parse(input);
    expect(result.name).toBe('full-bot');
    expect(result.description).toBe('A fully configured bot');
    expect(result.llm.temperature).toBe(0.7);
    expect(result.llm.maxTokens).toBe(2048);
    expect(result.tools).toEqual(['web-search', 'calculator']);
    expect(result.routing).toHaveLength(2);
    expect(result.memory.conversationWindow).toBe(50);
    expect(result.memory.summarizeAfter).toBe(100);
    expect(result.memory.userProfiles).toBe(false);
    expect(result.triggers).toHaveLength(1);
    expect(result.handoff?.enabled).toBe(true);
    expect(result.maxSteps).toBe(20);
    expect(result.cooldownMs).toBe(10000);
    expect(result.rateLimitPerWindow).toBe(5);
  });

  it('throws when name is missing', () => {
    const { name, ...rest } = minimalAgentInput();
    expect(() => AgentConfigSchema.parse(rest)).toThrow();
  });

  it('throws when llm is missing', () => {
    const { llm, ...rest } = minimalAgentInput();
    expect(() => AgentConfigSchema.parse(rest)).toThrow();
  });

  it('throws when personality is missing', () => {
    const { personality, ...rest } = minimalAgentInput();
    expect(() => AgentConfigSchema.parse(rest)).toThrow();
  });

  it('throws on invalid llm.provider', () => {
    const input = { ...minimalAgentInput(), llm: { provider: 'gemini', model: 'gemini-pro' } };
    expect(() => AgentConfigSchema.parse(input)).toThrow();
  });

  it('throws when llm.temperature is out of range', () => {
    const input = { ...minimalAgentInput(), llm: { provider: 'anthropic', model: 'm', temperature: 3 } };
    expect(() => AgentConfigSchema.parse(input)).toThrow();
  });

  it('throws when maxSteps is zero or negative', () => {
    expect(() => AgentConfigSchema.parse({ ...minimalAgentInput(), maxSteps: 0 })).toThrow();
    expect(() => AgentConfigSchema.parse({ ...minimalAgentInput(), maxSteps: -1 })).toThrow();
  });

  it('throws when cooldownMs is negative', () => {
    expect(() => AgentConfigSchema.parse({ ...minimalAgentInput(), cooldownMs: -1 })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// 2. ProjectConfigSchema validation
// ---------------------------------------------------------------------------

describe('ProjectConfigSchema', () => {
  it('parses valid config with version 1 and applies defaults', () => {
    const result = ProjectConfigSchema.parse({ version: 1 });
    expect(result.version).toBe(1);
    expect(result.agents.dir).toBe('./agents');
    expect(result.log.level).toBe('info');
    expect(result.webSearch.provider).toBe('tavily');
  });

  it('parses full project config', () => {
    const result = ProjectConfigSchema.parse({
      version: 1,
      agents: { dir: './my-agents' },
      auth: { dir: './auth' },
      db: { path: './data/db.sqlite' },
      log: { level: 'debug' },
      webSearch: { provider: 'brave', apiKey: 'key-123' },
    });
    expect(result.agents.dir).toBe('./my-agents');
    expect(result.auth.dir).toBe('./auth');
    expect(result.db.path).toBe('./data/db.sqlite');
    expect(result.log.level).toBe('debug');
    expect(result.webSearch.provider).toBe('brave');
    expect(result.webSearch.apiKey).toBe('key-123');
  });

  it('throws when version is missing', () => {
    expect(() => ProjectConfigSchema.parse({})).toThrow();
  });

  it('throws when version is wrong (2)', () => {
    expect(() => ProjectConfigSchema.parse({ version: 2 })).toThrow();
  });

  it('throws on invalid log level', () => {
    expect(() => ProjectConfigSchema.parse({ version: 1, log: { level: 'verbose' } })).toThrow();
  });

  it('throws on invalid webSearch provider', () => {
    expect(() => ProjectConfigSchema.parse({ version: 1, webSearch: { provider: 'google' } })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// 3. Env var interpolation (tested through loader functions)
// ---------------------------------------------------------------------------

describe('Env var interpolation', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'wa-agent-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.TEST_API_KEY;
    delete process.env.TEST_MODEL;
  });

  it('substitutes env vars in project config', () => {
    process.env.TEST_API_KEY = 'secret-key-123';
    const config = { version: 1, webSearch: { provider: 'tavily', apiKey: '${TEST_API_KEY}' } };
    writeFileSync(join(tmpDir, 'wa-agent.yaml'), toYaml(config));

    const result = loadProjectConfig(tmpDir);
    expect(result.webSearch.apiKey).toBe('secret-key-123');
  });

  it('substitutes env vars in agent config', () => {
    process.env.TEST_MODEL = 'claude-sonnet-4-20250514';
    const config = {
      name: 'env-bot',
      llm: { provider: 'anthropic', model: '${TEST_MODEL}' },
      personality: 'Hello',
    };
    const filePath = join(tmpDir, 'agent.yaml');
    writeFileSync(filePath, toYaml(config));

    const result = loadAgentConfig(filePath);
    expect(result.llm.model).toBe('claude-sonnet-4-20250514');
  });

  it('replaces missing env var with empty string', () => {
    // TEST_MISSING is not set
    const config = {
      name: 'missing-env-bot',
      llm: { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
      personality: 'Key is ${TEST_MISSING}!',
    };
    const filePath = join(tmpDir, 'agent.yaml');
    writeFileSync(filePath, toYaml(config));

    const result = loadAgentConfig(filePath);
    expect(result.personality).toBe('Key is !');
  });

  it('handles multiple env vars in the same string', () => {
    process.env.TEST_API_KEY = 'abc';
    process.env.TEST_MODEL = 'xyz';
    const config = {
      name: 'multi-env',
      llm: { provider: 'anthropic', model: '${TEST_MODEL}' },
      personality: '${TEST_API_KEY} and ${TEST_MODEL}',
    };
    const filePath = join(tmpDir, 'agent.yaml');
    writeFileSync(filePath, toYaml(config));

    const result = loadAgentConfig(filePath);
    expect(result.personality).toBe('abc and xyz');
  });
});

// ---------------------------------------------------------------------------
// 4. loadProjectConfig
// ---------------------------------------------------------------------------

describe('loadProjectConfig', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'wa-agent-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('throws when wa-agent.yaml does not exist', () => {
    expect(() => loadProjectConfig(tmpDir)).toThrow(/not found/);
  });

  it('throws on invalid YAML content', () => {
    writeFileSync(join(tmpDir, 'wa-agent.yaml'), 'version: "not-a-number"');
    expect(() => loadProjectConfig(tmpDir)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// 5. loadAllAgentConfigs
// ---------------------------------------------------------------------------

describe('loadAllAgentConfigs', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'wa-agent-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('loads multiple agent YAML files from a directory', () => {
    const agentsDir = join(tmpDir, 'agents');
    mkdirSync(agentsDir);

    const agent1 = { name: 'bot-a', llm: { provider: 'anthropic', model: 'claude-sonnet-4-20250514' }, personality: 'A' };
    const agent2 = { name: 'bot-b', llm: { provider: 'openai', model: 'gpt-4o' }, personality: 'B' };
    writeFileSync(join(agentsDir, 'a.yaml'), toYaml(agent1));
    writeFileSync(join(agentsDir, 'b.yml'), toYaml(agent2));

    const configs = loadAllAgentConfigs(tmpDir, 'agents');
    expect(configs).toHaveLength(2);
    const names = configs.map(c => c.name).sort();
    expect(names).toEqual(['bot-a', 'bot-b']);
  });

  it('throws if agents directory does not exist', () => {
    expect(() => loadAllAgentConfigs(tmpDir, 'missing-dir')).toThrow(/not found/);
  });

  it('returns empty array for directory with no YAML files', () => {
    const agentsDir = join(tmpDir, 'agents');
    mkdirSync(agentsDir);
    writeFileSync(join(agentsDir, 'readme.txt'), 'not yaml');

    const configs = loadAllAgentConfigs(tmpDir, 'agents');
    expect(configs).toEqual([]);
  });

  it('throws on invalid agent YAML in directory', () => {
    const agentsDir = join(tmpDir, 'agents');
    mkdirSync(agentsDir);
    // Missing required fields
    writeFileSync(join(agentsDir, 'bad.yaml'), toYaml({ name: 'incomplete' }));

    expect(() => loadAllAgentConfigs(tmpDir, 'agents')).toThrow(/Failed to load agent config/);
  });

  it('ignores non-YAML files in the directory', () => {
    const agentsDir = join(tmpDir, 'agents');
    mkdirSync(agentsDir);

    const agent = { name: 'bot-only', llm: { provider: 'anthropic', model: 'claude-sonnet-4-20250514' }, personality: 'Solo' };
    writeFileSync(join(agentsDir, 'bot.yaml'), toYaml(agent));
    writeFileSync(join(agentsDir, 'notes.txt'), 'ignore me');
    writeFileSync(join(agentsDir, 'data.json'), '{}');

    const configs = loadAllAgentConfigs(tmpDir, 'agents');
    expect(configs).toHaveLength(1);
    expect(configs[0].name).toBe('bot-only');
  });
});
