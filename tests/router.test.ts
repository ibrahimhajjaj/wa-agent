import { describe, it, expect, beforeEach } from 'vitest';
import { Router } from '../src/runtime/router.js';
import type { AgentConfig, AgentInstance } from '../src/agent/types.js';
import { RefCountMap } from '../src/agent/types.js';
import type { ParsedMessage } from '@ibrahimwithi/wu-cli';

function mockMessage(overrides: Partial<ParsedMessage> = {}): ParsedMessage {
  return {
    id: 'msg-1',
    chatJid: '1234@s.whatsapp.net',
    senderJid: '1234@s.whatsapp.net',
    senderName: 'Test User',
    body: 'hello',
    type: 'text',
    isFromMe: false,
    timestamp: Date.now(),
    mediaMime: null,
    mediaSize: null,
    quotedId: null,
    raw: {} as any,
    ...overrides,
  };
}

function mockAgent(config: Partial<AgentConfig> = {}, draining = false): AgentInstance {
  return {
    config: {
      name: 'test-agent',
      llm: { provider: 'anthropic', model: 'test' },
      personality: 'test',
      tools: [],
      routing: [{ type: 'default', match: '*' }],
      memory: { conversationWindow: 20, userProfiles: true },
      maxSteps: 10,
      cooldownMs: 5000,
      rateLimitPerWindow: 10,
      ...config,
    } as AgentConfig,
    model: {} as any,
    draining,
    activeChats: new RefCountMap(),
  };
}

describe('Router', () => {
  let router: Router;

  beforeEach(() => {
    router = new Router();
  });

  describe('register and unregister', () => {
    it('registers an agent and lists it', () => {
      const agent = mockAgent({ name: 'alpha' });
      router.register(agent.config, agent);
      expect(router.getAgentNames()).toEqual(['alpha']);
    });

    it('unregisters an agent by name', () => {
      const agent = mockAgent({ name: 'alpha' });
      router.register(agent.config, agent);
      router.unregister('alpha');
      expect(router.getAgentNames()).toEqual([]);
    });

    it('getAgents returns a copy of the registered agents', () => {
      const agent = mockAgent({ name: 'alpha' });
      router.register(agent.config, agent);
      const agents = router.getAgents();
      expect(agents).toHaveLength(1);
      expect(agents[0].config.name).toBe('alpha');
      // Mutating returned array should not affect internal state
      agents.pop();
      expect(router.getAgents()).toHaveLength(1);
    });
  });

  describe('JID routing', () => {
    it('matches on chatJid', () => {
      const agent = mockAgent({
        name: 'jid-agent',
        routing: [{ type: 'jid', match: '5555@s.whatsapp.net' }],
      });
      router.register(agent.config, agent);

      const msg = mockMessage({ chatJid: '5555@s.whatsapp.net' });
      expect(router.resolve(msg)).toBe(agent);
    });

    it('matches on senderJid', () => {
      const agent = mockAgent({
        name: 'jid-agent',
        routing: [{ type: 'jid', match: '9999@s.whatsapp.net' }],
      });
      router.register(agent.config, agent);

      const msg = mockMessage({
        chatJid: 'group@g.us',
        senderJid: '9999@s.whatsapp.net',
      });
      expect(router.resolve(msg)).toBe(agent);
    });

    it('does not match when neither chatJid nor senderJid matches', () => {
      const agent = mockAgent({
        name: 'jid-agent',
        routing: [{ type: 'jid', match: '5555@s.whatsapp.net' }],
      });
      router.register(agent.config, agent);

      const msg = mockMessage({
        chatJid: '0000@s.whatsapp.net',
        senderJid: '0000@s.whatsapp.net',
      });
      expect(router.resolve(msg)).toBeNull();
    });
  });

  describe('group routing', () => {
    it('matches group JID', () => {
      const agent = mockAgent({
        name: 'group-agent',
        routing: [{ type: 'group', match: 'mygroup@g.us' }],
      });
      router.register(agent.config, agent);

      const msg = mockMessage({ chatJid: 'mygroup@g.us' });
      expect(router.resolve(msg)).toBe(agent);
    });

    it('does not match a different group JID', () => {
      const agent = mockAgent({
        name: 'group-agent',
        routing: [{ type: 'group', match: 'mygroup@g.us' }],
      });
      router.register(agent.config, agent);

      const msg = mockMessage({ chatJid: 'othergroup@g.us' });
      expect(router.resolve(msg)).toBeNull();
    });
  });

  describe('keyword routing', () => {
    it('matches keyword in message body', () => {
      const agent = mockAgent({
        name: 'keyword-agent',
        routing: [{ type: 'keyword', match: 'help' }],
      });
      router.register(agent.config, agent);

      const msg = mockMessage({ body: 'I need help please' });
      expect(router.resolve(msg)).toBe(agent);
    });

    it('is case insensitive', () => {
      const agent = mockAgent({
        name: 'keyword-agent',
        routing: [{ type: 'keyword', match: 'hello' }],
      });
      router.register(agent.config, agent);

      const msg = mockMessage({ body: 'HELLO WORLD' });
      expect(router.resolve(msg)).toBe(agent);
    });

    it('supports regex patterns', () => {
      const agent = mockAgent({
        name: 'keyword-agent',
        routing: [{ type: 'keyword', match: '^!order\\b' }],
      });
      router.register(agent.config, agent);

      expect(router.resolve(mockMessage({ body: '!order pizza' }))).toBe(agent);
      expect(router.resolve(mockMessage({ body: 'I want to !order' }))).toBeNull();
    });

    it('does not match when body is empty', () => {
      const agent = mockAgent({
        name: 'keyword-agent',
        routing: [{ type: 'keyword', match: 'hello' }],
      });
      router.register(agent.config, agent);

      const msg = mockMessage({ body: '' });
      expect(router.resolve(msg)).toBeNull();
    });
  });

  describe('default routing', () => {
    it('matches any message', () => {
      const agent = mockAgent({
        name: 'default-agent',
        routing: [{ type: 'default', match: '*' }],
      });
      router.register(agent.config, agent);

      expect(router.resolve(mockMessage())).toBe(agent);
      expect(router.resolve(mockMessage({ body: 'anything' }))).toBe(agent);
      expect(router.resolve(mockMessage({ chatJid: 'random@g.us' }))).toBe(agent);
    });
  });

  describe('routing priority', () => {
    it('JID match beats group match', () => {
      const jidAgent = mockAgent({
        name: 'jid-agent',
        routing: [{ type: 'jid', match: 'user@s.whatsapp.net' }],
      });
      const groupAgent = mockAgent({
        name: 'group-agent',
        routing: [{ type: 'group', match: 'user@s.whatsapp.net' }],
      });
      // Register group first so JID must win by priority, not insertion order
      router.register(groupAgent.config, groupAgent);
      router.register(jidAgent.config, jidAgent);

      const msg = mockMessage({ chatJid: 'user@s.whatsapp.net' });
      expect(router.resolve(msg)).toBe(jidAgent);
    });

    it('group match beats keyword match', () => {
      const groupAgent = mockAgent({
        name: 'group-agent',
        routing: [{ type: 'group', match: 'chat@g.us' }],
      });
      const keywordAgent = mockAgent({
        name: 'keyword-agent',
        routing: [{ type: 'keyword', match: 'hello' }],
      });
      router.register(keywordAgent.config, keywordAgent);
      router.register(groupAgent.config, groupAgent);

      const msg = mockMessage({ chatJid: 'chat@g.us', body: 'hello' });
      expect(router.resolve(msg)).toBe(groupAgent);
    });

    it('keyword match beats default', () => {
      const keywordAgent = mockAgent({
        name: 'keyword-agent',
        routing: [{ type: 'keyword', match: 'help' }],
      });
      const defaultAgent = mockAgent({
        name: 'default-agent',
        routing: [{ type: 'default', match: '*' }],
      });
      router.register(defaultAgent.config, defaultAgent);
      router.register(keywordAgent.config, keywordAgent);

      const msg = mockMessage({ body: 'I need help' });
      expect(router.resolve(msg)).toBe(keywordAgent);
    });

    it('default matches when nothing else does', () => {
      const jidAgent = mockAgent({
        name: 'jid-agent',
        routing: [{ type: 'jid', match: '9999@s.whatsapp.net' }],
      });
      const defaultAgent = mockAgent({
        name: 'default-agent',
        routing: [{ type: 'default', match: '*' }],
      });
      router.register(jidAgent.config, jidAgent);
      router.register(defaultAgent.config, defaultAgent);

      const msg = mockMessage({ chatJid: '1111@s.whatsapp.net', senderJid: '1111@s.whatsapp.net' });
      expect(router.resolve(msg)).toBe(defaultAgent);
    });

    it('custom priority overrides default type priority', () => {
      const defaultAgent = mockAgent({
        name: 'priority-default',
        routing: [{ type: 'default', match: '*', priority: 100 }],
      });
      const jidAgent = mockAgent({
        name: 'jid-agent',
        routing: [{ type: 'jid', match: '1234@s.whatsapp.net' }],
      });
      router.register(jidAgent.config, jidAgent);
      router.register(defaultAgent.config, defaultAgent);

      const msg = mockMessage({ chatJid: '1234@s.whatsapp.net' });
      // default agent has priority 100, jid agent has default 40
      expect(router.resolve(msg)).toBe(defaultAgent);
    });
  });

  describe('draining agents', () => {
    it('skips agents marked as draining', () => {
      const agent = mockAgent({ name: 'draining-agent' }, true);
      router.register(agent.config, agent);

      expect(router.resolve(mockMessage())).toBeNull();
    });

    it('falls back to non-draining agent when preferred is draining', () => {
      const drainingAgent = mockAgent(
        { name: 'draining', routing: [{ type: 'jid', match: '1234@s.whatsapp.net' }] },
        true,
      );
      const fallbackAgent = mockAgent({
        name: 'fallback',
        routing: [{ type: 'default', match: '*' }],
      });
      router.register(drainingAgent.config, drainingAgent);
      router.register(fallbackAgent.config, fallbackAgent);

      const msg = mockMessage({ chatJid: '1234@s.whatsapp.net' });
      expect(router.resolve(msg)).toBe(fallbackAgent);
    });
  });

  describe('no match', () => {
    it('returns null when no agents are registered', () => {
      expect(router.resolve(mockMessage())).toBeNull();
    });

    it('returns null when no routing rules match', () => {
      const agent = mockAgent({
        name: 'picky',
        routing: [{ type: 'jid', match: 'nobody@s.whatsapp.net' }],
      });
      router.register(agent.config, agent);

      expect(router.resolve(mockMessage())).toBeNull();
    });
  });

  describe('multiple agents', () => {
    it('selects the correct agent among many', () => {
      const agentA = mockAgent({
        name: 'agent-a',
        routing: [{ type: 'jid', match: 'alice@s.whatsapp.net' }],
      });
      const agentB = mockAgent({
        name: 'agent-b',
        routing: [{ type: 'group', match: 'devs@g.us' }],
      });
      const agentC = mockAgent({
        name: 'agent-c',
        routing: [{ type: 'keyword', match: 'deploy' }],
      });
      const agentD = mockAgent({
        name: 'agent-d',
        routing: [{ type: 'default', match: '*' }],
      });
      router.register(agentA.config, agentA);
      router.register(agentB.config, agentB);
      router.register(agentC.config, agentC);
      router.register(agentD.config, agentD);

      // JID match -> agent A
      expect(router.resolve(mockMessage({
        chatJid: 'alice@s.whatsapp.net',
        senderJid: 'alice@s.whatsapp.net',
      }))).toBe(agentA);

      // Group match -> agent B
      expect(router.resolve(mockMessage({
        chatJid: 'devs@g.us',
        body: 'deploy now',
      }))).toBe(agentB);

      // Keyword match -> agent C
      expect(router.resolve(mockMessage({
        chatJid: 'random@s.whatsapp.net',
        senderJid: 'random@s.whatsapp.net',
        body: 'please deploy',
      }))).toBe(agentC);

      // Default -> agent D
      expect(router.resolve(mockMessage({
        chatJid: 'random@s.whatsapp.net',
        senderJid: 'random@s.whatsapp.net',
        body: 'hi',
      }))).toBe(agentD);
    });
  });
});
