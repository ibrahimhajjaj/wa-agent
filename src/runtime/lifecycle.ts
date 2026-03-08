import type { AgentConfig, AgentInstance } from '../agent/types.js';
import { RefCountMap } from '../agent/types.js';
import { createModel } from '../agent/factory.js';
import { loadAgentConfig } from '../config/loader.js';
import { Router } from './router.js';
import { ChatQueue } from '../util/chat-queue.js';
import { createChildLogger } from '../util/logger.js';

const logger = createChildLogger('lifecycle');

const agentInstances = new Map<string, AgentInstance>();

export function createAgentInstance(config: AgentConfig): AgentInstance {
  const model = createModel(config.llm);
  const instance: AgentInstance = {
    config,
    model,
    draining: false,
    activeChats: new RefCountMap(),
  };
  agentInstances.set(config.name, instance);
  return instance;
}

export function getAgentInstance(name: string): AgentInstance | undefined {
  return agentInstances.get(name);
}

export function getAllAgentInstances(): AgentInstance[] {
  return [...agentInstances.values()];
}

export async function reloadAgent(
  name: string,
  agentFilePath: string,
  router: Router,
  chatQueue: ChatQueue,
): Promise<void> {
  const instance = agentInstances.get(name);
  if (!instance) return;

  // 1. Mark as draining
  instance.draining = true;

  // 2. Wait for in-flight tasks
  await chatQueue.drainForAgent(instance.activeChats);

  // 3. Remove old instance
  agentInstances.delete(name);
  router.unregister(name);

  // 4. Load new config
  const newConfig = loadAgentConfig(agentFilePath);
  const newInstance = createAgentInstance(newConfig);
  router.register(newConfig, newInstance);

  logger.info({ agent: name }, 'Agent hot-reloaded');
}

export function addAgent(
  config: AgentConfig,
  router: Router,
): AgentInstance {
  const instance = createAgentInstance(config);
  router.register(config, instance);
  logger.info({ agent: config.name }, 'New agent added');
  return instance;
}

export function destroyAllAgents(): void {
  for (const [name, instance] of agentInstances) {
    instance.draining = true;
    agentInstances.delete(name);
  }
}
