import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createOllama } from 'ollama-ai-provider';
import type { LanguageModel } from 'ai';
import type { LLMConfig } from './types.js';

export function createModel(config: LLMConfig): LanguageModel {
  switch (config.provider) {
    case 'anthropic': {
      const provider = createAnthropic(config.baseUrl ? { baseURL: config.baseUrl } : {});
      return provider(config.model);
    }
    case 'openai': {
      const provider = createOpenAI(config.baseUrl ? { baseURL: config.baseUrl } : {});
      return provider(config.model);
    }
    case 'ollama': {
      const provider = createOllama(config.baseUrl ? { baseURL: config.baseUrl } : {});
      return provider(config.model) as unknown as LanguageModel;
    }
    default:
      throw new Error(`Unknown LLM provider: ${config.provider}`);
  }
}
