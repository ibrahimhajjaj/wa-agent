import { resolve, join, basename } from 'path';
import { watch } from 'chokidar';
import { Engine } from '../runtime/engine.js';
import { reloadAgent, getAgentInstance, addAgent } from '../runtime/lifecycle.js';
import { loadProjectConfig, loadAgentConfig } from '../config/loader.js';
import { acquireLock, releaseLock } from '@ibrahimwithi/wu-cli';
import { closeDb } from '@ibrahimwithi/wu-cli';
import { createChildLogger } from '../util/logger.js';

const logger = createChildLogger('dev');

export async function devCommand(opts: { dir: string }): Promise<void> {
  const projectDir = resolve(opts.dir);
  logger.info({ projectDir }, 'Starting wa-agent in dev mode...');

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

  // Watch agent YAML files for changes
  const projectConfig = loadProjectConfig(projectDir);
  const agentsDir = resolve(projectDir, projectConfig.agents.dir);
  const watcher = watch(join(agentsDir, '*.{yaml,yml}'), {
    ignoreInitial: true,
  });

  const handleAgentFile = async (filePath: string) => {
    const agentName = basename(filePath).replace(/\.ya?ml$/, '');
    if (!agentName) return;

    const existing = getAgentInstance(agentName);
    if (existing) {
      logger.info({ agent: agentName, file: filePath }, 'Agent config changed, reloading...');
      try {
        await reloadAgent(agentName, filePath, engine.getRouter(), engine.getDispatcher()!.getChatQueue());
      } catch (err) {
        logger.error({ err, agent: agentName }, 'Failed to reload agent');
      }
    } else {
      logger.info({ agent: agentName, file: filePath }, 'New agent detected, adding...');
      try {
        const config = loadAgentConfig(filePath);
        addAgent(config, engine.getRouter());
      } catch (err) {
        logger.error({ err, agent: agentName }, 'Failed to add new agent');
      }
    }
  };

  watcher.on('change', handleAgentFile);
  watcher.on('add', handleAgentFile);

  logger.info({ dir: agentsDir }, 'Watching for agent config changes');
}
