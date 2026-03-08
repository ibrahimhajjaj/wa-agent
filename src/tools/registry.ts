import { existsSync, readdirSync } from 'fs';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';
import type { Tool } from 'ai';
import type { ToolContext } from './types.js';
import { createSendMessageTool } from './builtin/send-message.js';
import { createSearchMessagesTool } from './builtin/search-messages.js';
import { createGetChatHistoryTool } from './builtin/get-chat-history.js';
import { createWebSearchTool } from './builtin/web-search.js';
import { createFetchUrlTool } from './builtin/fetch-url.js';
import { createScheduleTool } from './builtin/schedule.js';
import { createHandoffTool } from './builtin/handoff.js';
import { createSendReactionTool } from './builtin/send-reaction.js';
import { createChildLogger } from '../util/logger.js';

const logger = createChildLogger('tools');

type ToolFactory = (ctx: ToolContext) => Tool;

const builtinTools: Record<string, ToolFactory> = {
  'send-message': createSendMessageTool,
  'search-messages': createSearchMessagesTool,
  'get-chat-history': createGetChatHistoryTool,
  'web-search': createWebSearchTool,
  'fetch-url': createFetchUrlTool,
  'schedule': createScheduleTool,
  'handoff': createHandoffTool,
  'send-reaction': createSendReactionTool,
};

const customTools = new Map<string, ToolFactory>();

export function registerCustomTool(name: string, factory: ToolFactory): void {
  customTools.set(name, factory);
}

/**
 * Scan a project's `tools/` directory for custom tool definitions.
 * Each `.ts` or `.js` file should export a factory function (as default export,
 * a named export matching the filename, or `createTool`).
 */
export async function loadCustomTools(projectDir: string): Promise<void> {
  const toolsDir = resolve(projectDir, 'tools');
  if (!existsSync(toolsDir)) return;

  const files = readdirSync(toolsDir).filter(f => f.endsWith('.js') || f.endsWith('.ts'));

  for (const file of files) {
    const name = file.replace(/\.(js|ts)$/, '');
    const filePath = join(toolsDir, file);

    try {
      const mod = await import(pathToFileURL(filePath).href);
      const factory = mod.default ?? mod[name] ?? mod.createTool;

      if (typeof factory !== 'function') {
        throw new Error(`Tool file must export a function (default, named '${name}', or 'createTool')`);
      }

      registerCustomTool(name, factory);
      logger.info({ name, file }, 'Loaded custom tool');
    } catch (err) {
      throw new Error(`Failed to load custom tool '${file}': ${err}`);
    }
  }
}

export function resolveTools(
  toolNames: string[],
  ctx: ToolContext,
): Record<string, Tool> {
  const resolved: Record<string, Tool> = {};

  for (const name of toolNames) {
    const factory = builtinTools[name] ?? customTools.get(name);
    if (!factory) {
      throw new Error(`Unknown tool: ${name}`);
    }
    resolved[name] = factory(ctx);
  }

  return resolved;
}
