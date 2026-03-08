import type { ParsedMessage } from '@ibrahimwithi/wu-cli';
import type { MiddlewareFn } from './pipeline.js';
import { getHandoffState } from '../memory/store.js';

/** Skip messages from chats that have been handed off to a human */
export function createHandoffCheckMiddleware(getAgentNames: () => string[]): MiddlewareFn {
  return (msg: ParsedMessage): boolean => {
    const agentNames = getAgentNames();
    // Check if ANY agent has this chat handed off
    for (const agentName of agentNames) {
      if (getHandoffState(agentName, msg.chatJid)) {
        return false;
      }
    }
    return true;
  };
}
