import type { LanguageModel } from 'ai';

export interface AgentConfig {
  name: string;
  description?: string;
  llm: LLMConfig;
  personality: string;
  tools: string[];
  routing: RoutingRule[];
  memory: MemoryConfig;
  triggers?: TriggerConfig[];
  handoff?: HandoffConfig;
  maxSteps?: number;
  cooldownMs?: number;
  rateLimitPerWindow?: number;
}

export interface LLMConfig {
  provider: 'anthropic' | 'openai' | 'ollama';
  model: string;
  temperature?: number;
  maxTokens?: number;
  baseUrl?: string;
}

export interface RoutingRule {
  type: 'jid' | 'group' | 'keyword' | 'default';
  match: string;
  priority?: number;
}

export interface MemoryConfig {
  conversationWindow: number;
  summarizeAfter?: number;
  userProfiles: boolean;
}

export interface TriggerConfig {
  type: 'cron';
  schedule: string;
  action: string;
  target: string;
  payload?: Record<string, unknown>;
}

export interface HandoffConfig {
  enabled: boolean;
  escalateTo: string;
  conditions?: string[];
}

export interface AgentInstance {
  config: AgentConfig;
  model: LanguageModel;
  draining: boolean;
  activeChats: RefCountMap;
}

export class RefCountMap {
  private counts = new Map<string, number>();

  increment(key: string): void {
    this.counts.set(key, (this.counts.get(key) ?? 0) + 1);
  }

  decrement(key: string): void {
    const n = (this.counts.get(key) ?? 1) - 1;
    if (n <= 0) this.counts.delete(key);
    else this.counts.set(key, n);
  }

  has(key: string): boolean {
    return this.counts.has(key);
  }

  activeKeys(): string[] {
    return [...this.counts.keys()];
  }
}
