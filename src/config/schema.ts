import { z } from 'zod';

// --- Agent YAML Schema ---

const LLMConfigSchema = z.object({
  provider: z.enum(['anthropic', 'openai', 'ollama']),
  model: z.string(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().positive().optional(),
  baseUrl: z.string().optional(),
});

const RoutingRuleSchema = z.object({
  type: z.enum(['jid', 'group', 'keyword', 'default']),
  match: z.string(),
  priority: z.number().optional(),
});

const MemoryConfigSchema = z.object({
  conversationWindow: z.number().positive().default(20),
  summarizeAfter: z.number().positive().optional(),
  userProfiles: z.boolean().default(true),
});

const TriggerConfigSchema = z.object({
  type: z.literal('cron'),
  schedule: z.string(),
  action: z.string(),
  target: z.string(),
  payload: z.record(z.unknown()).optional(),
});

const HandoffConfigSchema = z.object({
  enabled: z.boolean(),
  escalateTo: z.string(),
  conditions: z.array(z.string()).optional(),
});

export const AgentConfigSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  llm: LLMConfigSchema,
  personality: z.string(),
  tools: z.array(z.string()).default([]),
  routing: z.array(RoutingRuleSchema).default([]),
  memory: MemoryConfigSchema.default({}),
  triggers: z.array(TriggerConfigSchema).optional(),
  handoff: HandoffConfigSchema.optional(),
  maxSteps: z.number().positive().default(10),
  cooldownMs: z.number().nonnegative().default(5000),
  rateLimitPerWindow: z.number().positive().default(10),
});

// --- Project Config Schema (wa-agent.yaml) ---

export const ProjectConfigSchema = z.object({
  version: z.literal(1),
  agents: z.object({
    dir: z.string().default('./agents'),
  }).default({}),
  auth: z.object({
    dir: z.string().optional(),
  }).default({}),
  db: z.object({
    path: z.string().optional(),
  }).default({}),
  log: z.object({
    level: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  }).default({}),
  webSearch: z.object({
    provider: z.enum(['tavily', 'brave', 'serper']).default('tavily'),
    apiKey: z.string().optional(),
  }).default({}),
  fetchUrl: z.object({
    provider: z.enum(['local', 'jina']).default('jina'),
    apiKey: z.string().optional(), // optional — Jina works without a key (20 RPM), with key gets 500 RPM
  }).default({}),
});

export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;
