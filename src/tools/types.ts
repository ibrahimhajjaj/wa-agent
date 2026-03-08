import { tool, type Tool } from 'ai';
import type { WASocket } from '@whiskeysockets/baileys';
import type { AgentConfig } from '../agent/types.js';
import type { WuConfig } from '@ibrahimwithi/wu-cli';
import type { ProjectConfig } from '../config/schema.js';
import type { z } from 'zod';

export interface ToolContext {
  chatJid: string;
  senderJid: string | null;
  senderName: string | null;
  messageId: string;
  agentConfig: AgentConfig;
  sock: WASocket;
  config: WuConfig;
  projectConfig: ProjectConfig;
}

/**
 * Helper for defining custom tools with a consistent factory pattern.
 * Returns a factory function that takes a ToolContext and produces a Tool.
 *
 * Usage:
 * ```ts
 * export default defineTool({
 *   description: 'My custom tool',
 *   inputSchema: z.object({ query: z.string() }),
 *   execute: async (input, ctx) => { ... },
 * });
 * ```
 */
export function defineTool<TSchema extends z.ZodObject<z.ZodRawShape>>(opts: {
  description: string;
  inputSchema: TSchema;
  execute: (input: z.infer<TSchema>, ctx: ToolContext) => Promise<unknown>;
}): (ctx: ToolContext) => Tool {
  return (ctx: ToolContext) => tool({
    description: opts.description,
    inputSchema: opts.inputSchema,
    execute: async (input: z.infer<TSchema>) => opts.execute(input, ctx),
  }) as Tool;
}
