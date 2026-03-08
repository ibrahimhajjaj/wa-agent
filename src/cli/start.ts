import { resolve } from 'path';
import { Engine } from '../runtime/engine.js';
import { acquireLock, releaseLock } from '@ibrahimwithi/wu-cli';
import { closeDb } from '@ibrahimwithi/wu-cli';
import { createChildLogger } from '../util/logger.js';

const logger = createChildLogger('cli');

export async function startCommand(opts: { dir: string }): Promise<void> {
  const projectDir = resolve(opts.dir);
  logger.info({ projectDir }, 'Starting wa-agent...');

  acquireLock();

  const engine = new Engine(projectDir);

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down...');
    await engine.stop();
    releaseLock();
    closeDb();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  try {
    await engine.start();
  } catch (err) {
    logger.error({ err }, 'Failed to start engine');
    releaseLock();
    closeDb();
    process.exit(1);
  }
}
