# wa-agent

Build autonomous AI agents that live on WhatsApp.

wa-agent gives you the plumbing so you can focus on the agent. You write a YAML file describing your agent's personality, tools, and routing rules — wa-agent handles the WhatsApp connection, message queuing, conversation memory, tool execution, and everything else.

Powered by [Vercel AI SDK v6](https://sdk.vercel.ai/) for the agent layer and [wu-cli](https://github.com/ibrahimhajjaj/wu-cli) for battle-tested WhatsApp internals.

## Quick Start

```bash
npx wa-agent init my-bot
cd my-bot
npm install
```

Edit `wa-agent.yaml` with your API keys:

```yaml
version: 1

agents:
  dir: ./agents

webSearch:
  provider: tavily
  apiKey: "${TAVILY_API_KEY}"

fetchUrl:
  provider: jina        # jina (default) | local
  # apiKey: "${JINA_API_KEY}"  # optional — works without key (20 RPM), with key gets 500 RPM
```

Edit `agents/my-agent.yaml`:

```yaml
name: my-agent
description: My WhatsApp AI agent

llm:
  provider: anthropic
  model: claude-sonnet-4-20250514
  temperature: 0.7

personality: |
  You are a helpful WhatsApp assistant. Be concise — this is WhatsApp,
  not email. Use short paragraphs and get to the point quickly.

tools:
  - send-message
  - web-search
  - fetch-url

routing:
  - type: default
    match: "*"

memory:
  conversationWindow: 20
  summarizeAfter: 100
  userProfiles: true
```

Start it up:

```bash
npx wa-agent start
```

First run will show a QR code — scan it with WhatsApp to link the agent. wu-cli handles reconnection automatically after that. You only need to re-scan if WhatsApp terminates the linked device (rare, usually from inactivity or logging out manually).

## Why wa-agent?

Every WhatsApp bot repo out there is the same thing: glue code piping messages to OpenAI. No memory across conversations. No tool use. No multi-agent routing. No rate limiting. No way to handle a busy group without burning through your API budget.

wa-agent is a framework, not a chatbot template. It gives you:

- **Real agent loop** — tools, multi-step reasoning, `generateText` with automatic step limiting
- **Conversation memory** — summaries of old conversations, user profiles extracted over time
- **Multi-agent routing** — route messages to different agents by JID, group, keyword, or default
- **Per-chat queuing** — messages from the same chat are serialized, different chats run in parallel
- **Rate limiting & cooldowns** — per-agent, per-chat, so a noisy group doesn't drain your wallet
- **Scheduled messages** — cron triggers and one-shot scheduled tasks
- **Human handoff** — escalate to a human operator when the agent can't handle it
- **Hot reload** — change an agent's YAML config in dev mode, it picks it up without restarting
- **Custom tools** — drop a `.ts` file in `tools/`, it's available to your agents
- **Any LLM** — Anthropic, OpenAI, or Ollama (local models)

## Agent Config

The full set of options for an agent YAML file:

```yaml
name: support-bot
description: Customer support agent

llm:
  provider: anthropic          # anthropic | openai | ollama
  model: claude-sonnet-4-20250514
  temperature: 0.7
  maxTokens: 4096
  baseUrl: https://...         # optional, for custom endpoints

personality: |
  You are a customer support agent. Search the knowledge base first,
  create a ticket if you can't resolve. Be concise — this is WhatsApp.

tools:
  - send-message
  - search-messages
  - get-chat-history
  - web-search
  - fetch-url
  - schedule
  - send-reaction
  - handoff

routing:
  - type: group                # route by group JID
    match: "120363XXX@g.us"
  - type: keyword              # route by regex on message body
    match: "help|support|issue"
  - type: jid                  # route by exact sender/chat JID
    match: "1234567890@s.whatsapp.net"
  - type: default              # catch-all
    match: "*"

memory:
  conversationWindow: 30       # messages to include in LLM context
  summarizeAfter: 100          # summarize after N messages
  userProfiles: true           # extract user facts over time

maxSteps: 10                   # max tool-use steps per message
cooldownMs: 5000               # don't respond within N ms of last response
rateLimitPerWindow: 15         # max LLM calls per chat per 5 min

triggers:                        # scheduled triggers execute the tool directly
  - type: cron                   # with the payload — no LLM call is made
    schedule: "0 9 * * 1"       # every Monday at 9am
    action: send-message
    target: "120363XXX@g.us"
    payload:
      text: "Good morning! Here's your weekly update..."

handoff:
  enabled: true
  escalateTo: "1234567890@s.whatsapp.net"
  conditions:
    - "User explicitly asks for a human"
    - "User is frustrated after 3 failed attempts"
    - "Request involves payment or sensitive info"
```

## Built-in Tools

| Tool | What it does |
|------|-------------|
| `send-message` | Send text or media to any chat |
| `search-messages` | Full-text search across message history |
| `get-chat-history` | Get recent messages from a chat |
| `send-reaction` | React to a message with an emoji |
| `web-search` | Search the web (Tavily, Brave, or Serper) |
| `fetch-url` | Fetch a URL and extract text content (Jina Reader for JS-rendered pages, or local HTML parser) |
| `schedule` | Schedule a message for later |
| `handoff` | Escalate to a human operator |

## Custom Tools

Drop a file in your project's `tools/` directory:

```ts
// tools/weather.ts
import { defineTool } from 'wa-agent/tools/types';
import { z } from 'zod';

export default defineTool({
  description: 'Get current weather for a location',
  inputSchema: z.object({
    location: z.string().describe('City name'),
  }),
  execute: async ({ location }, ctx) => {
    const res = await fetch(`https://wttr.in/${encodeURIComponent(location)}?format=j1`);
    const data = await res.json();
    return {
      location,
      temp: data.current_condition[0].temp_C,
      description: data.current_condition[0].weatherDesc[0].value,
    };
  },
});
```

Then add it to your agent's tools list:

```yaml
tools:
  - send-message
  - weather
```

## Multi-Agent Setup

Run multiple agents with different routing rules. Each agent has its own personality, tools, and LLM config.

```
agents/
  support-bot.yaml     # handles messages with "help", "support", "issue"
  sales-bot.yaml       # handles a specific group
  default-bot.yaml     # catches everything else
```

Routing priority: `jid` (exact match) > `group` > `keyword` (regex) > `default`.

## LLM Providers

**Anthropic** (default):
```yaml
llm:
  provider: anthropic
  model: claude-sonnet-4-20250514
```
Requires `ANTHROPIC_API_KEY` env var.

**OpenAI**:
```yaml
llm:
  provider: openai
  model: gpt-4o
```
Requires `OPENAI_API_KEY` env var.

**Ollama** (local):
```yaml
llm:
  provider: ollama
  model: llama3
  baseUrl: http://localhost:11434
```
No API key needed. Run [Ollama](https://ollama.com) locally.

## CLI Commands

```bash
wa-agent init <name>     # scaffold a new project
wa-agent start           # start the engine
wa-agent dev             # start with hot-reload (watches agent YAML files)
wa-agent agents list     # show configured agents and their routing
```

Sample output from `wa-agent agents list`:

```
Configured agents (2):

  support-bot
    Customer support agent
    Provider: anthropic (claude-sonnet-4-20250514)
    Tools: send-message, search-messages, web-search, handoff
    Routing: group:120363XXX@g.us, keyword:help|support|issue
    Triggers: 1 configured
    Handed-off chats: 2

  default-bot
    General assistant
    Provider: openai (gpt-4o)
    Tools: send-message, web-search, fetch-url
    Routing: default:*
```

## Architecture

```
WhatsApp
  │
  ▼
wu-cli (Baileys connection + message storage)
  │
  ▼
Middleware Pipeline
  ├─ filter (skip own messages, broadcasts)
  └─ handoff-check (skip handed-off chats)
  │
  ▼
Router (jid > group > keyword > default)
  │
  ▼
Dispatcher
  ├─ cooldown check (per-agent, per-chat)
  ├─ rate limit check (per-agent, per-chat)
  └─ chat queue (serialize per-JID)
      │
      ▼
    Agent (generateText + tools)
      ├─ typing indicator ON
      ├─ build context (system prompt + memory + history)
      ├─ generateText() with tool loop
      ├─ send response
      ├─ typing indicator OFF
      └─ background: summarize + update user profile
```

Messages from the same chat are always processed one at a time. Messages from different chats run in parallel.

## How Memory Works

wa-agent doesn't duplicate messages. It reads directly from wu-cli's SQLite database for conversation history.

On top of that, it maintains:

- **Conversation summaries** — when a chat exceeds `summarizeAfter` messages, the agent summarizes older messages in the background and includes the summary in future context
- **User profiles** — facts about users are extracted over time ("lives in Dubai", "prefers Arabic") and included in the system prompt

This means your agent remembers context across conversations without stuffing the entire history into every LLM call.

## Deployment

wa-agent is a long-running process. On a VPS, use PM2 or systemd to keep it alive:

```js
// ecosystem.config.cjs (PM2)
module.exports = {
  apps: [{
    name: 'wa-agent',
    script: 'npx',
    args: 'wa-agent start',
    cwd: '/home/deploy/my-bot',
    env: {
      ANTHROPIC_API_KEY: 'sk-ant-...',
      NODE_ENV: 'production',
    },
  }],
};
```

```bash
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

## Requirements

- Node.js >= 20
- A WhatsApp account to link (scans QR code on first run)
- An API key for your LLM provider (Anthropic, OpenAI, or local Ollama)

`better-sqlite3` (pulled in by wu-cli) compiles a native C++ binding during `npm install`. On Ubuntu/Debian, make sure you have the build tools:

```bash
apt-get install build-essential python3
```

## License

MIT
