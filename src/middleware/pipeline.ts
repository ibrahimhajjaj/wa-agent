import type { ParsedMessage } from '@ibrahimwithi/wu-cli';
import { createChildLogger } from '../util/logger.js';

const logger = createChildLogger('middleware');

export type MiddlewareFn = (msg: ParsedMessage) => boolean; // true = pass, false = reject

export class MiddlewarePipeline {
  private middlewares: Array<{ name: string; fn: MiddlewareFn }> = [];

  use(name: string, fn: MiddlewareFn): void {
    this.middlewares.push({ name, fn });
  }

  run(msg: ParsedMessage): boolean {
    for (const { name, fn } of this.middlewares) {
      if (!fn(msg)) {
        logger.debug({ middleware: name, chatJid: msg.chatJid, msgId: msg.id }, 'Message rejected');
        return false;
      }
    }
    return true;
  }
}
