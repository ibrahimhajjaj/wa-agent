import type { ParsedMessage } from '@ibrahimwithi/wu-cli';
import type { AgentConfig, AgentInstance } from '../agent/types.js';
import { createChildLogger } from '../util/logger.js';

const logger = createChildLogger('router');

interface RegisteredAgent {
  config: AgentConfig;
  instance: AgentInstance;
}

export class Router {
  private agents: RegisteredAgent[] = [];
  private regexCache = new Map<string, RegExp>();

  register(config: AgentConfig, instance: AgentInstance): void {
    this.agents.push({ config, instance });
    logger.info({ agent: config.name, rules: config.routing.length }, 'Registered agent');
  }

  unregister(name: string): void {
    this.agents = this.agents.filter(a => a.config.name !== name);
    logger.info({ agent: name }, 'Unregistered agent');
  }

  resolve(msg: ParsedMessage): AgentInstance | null {
    let bestMatch: RegisteredAgent | null = null;
    let bestPriority = -1;

    for (const agent of this.agents) {
      // Skip draining agents
      if (agent.instance.draining) continue;

      for (const rule of agent.config.routing) {
        const priority = this.getRulePriority(rule);

        if (priority <= bestPriority) continue;

        if (this.matchesRule(msg, rule)) {
          bestMatch = agent;
          bestPriority = priority;
        }
      }
    }

    if (bestMatch) {
      logger.debug({ agent: bestMatch.config.name, chatJid: msg.chatJid }, 'Routed message');
    }

    return bestMatch?.instance ?? null;
  }

  private getRulePriority(rule: AgentConfig['routing'][0]): number {
    if (rule.priority !== undefined) return rule.priority;
    // Default priorities: jid > group > keyword > default
    switch (rule.type) {
      case 'jid': return 40;
      case 'group': return 30;
      case 'keyword': return 20;
      case 'default': return 10;
    }
  }

  private matchesRule(msg: ParsedMessage, rule: AgentConfig['routing'][0]): boolean {
    switch (rule.type) {
      case 'jid':
        return msg.chatJid === rule.match || msg.senderJid === rule.match;
      case 'group':
        return msg.chatJid === rule.match;
      case 'keyword': {
        if (!msg.body) return false;
        let regex = this.regexCache.get(rule.match);
        if (!regex) {
          regex = new RegExp(rule.match, 'i');
          this.regexCache.set(rule.match, regex);
        }
        return regex.test(msg.body);
      }
      case 'default':
        return true;
    }
  }

  getAgentNames(): string[] {
    return this.agents.map(a => a.config.name);
  }

  getAgents(): RegisteredAgent[] {
    return [...this.agents];
  }
}
