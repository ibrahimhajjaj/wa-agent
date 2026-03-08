import type { ParsedMessage } from '@ibrahimwithi/wu-cli';
import type { MiddlewareFn } from './pipeline.js';

/** Skip own messages, broadcasts, and status updates */
export function createFilterMiddleware(): MiddlewareFn {
  return (msg: ParsedMessage): boolean => {
    // Skip own messages
    if (msg.isFromMe) return false;

    // Skip status broadcasts
    if (msg.chatJid === 'status@broadcast' || msg.chatJid.endsWith('@broadcast')) return false;

    // Skip empty messages
    if (!msg.body && msg.type === 'unknown') return false;

    return true;
  };
}
