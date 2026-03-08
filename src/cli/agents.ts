import { resolve } from 'path';
import { loadProjectConfig, loadAllAgentConfigs } from '../config/loader.js';
import { getHandedOffChats } from '../memory/store.js';

export async function agentsCommand(opts: { dir: string }): Promise<void> {
  const projectDir = resolve(opts.dir);

  try {
    const projectConfig = loadProjectConfig(projectDir);
    const agents = loadAllAgentConfigs(projectDir, projectConfig.agents.dir);

    if (agents.length === 0) {
      console.log('No agents configured.');
      return;
    }

    console.log(`\nConfigured agents (${agents.length}):\n`);
    for (const agent of agents) {
      console.log(`  ${agent.name}`);
      if (agent.description) console.log(`    ${agent.description}`);
      console.log(`    Provider: ${agent.llm.provider} (${agent.llm.model})`);
      console.log(`    Tools: ${agent.tools.join(', ') || 'none'}`);
      console.log(`    Routing: ${agent.routing.map(r => `${r.type}:${r.match}`).join(', ')}`);
      if (agent.triggers?.length) {
        console.log(`    Triggers: ${agent.triggers.length} configured`);
      }
      try {
        const handedOff = getHandedOffChats(agent.name);
        if (handedOff.length > 0) {
          console.log(`    Handed-off chats: ${handedOff.length}`);
        }
      } catch {
        // DB may not be initialized in standalone CLI mode
      }
      console.log();
    }
  } catch (err) {
    console.error('Error:', (err as Error).message);
    process.exit(1);
  }
}
