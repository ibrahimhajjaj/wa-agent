import { mkdirSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const AGENT_YAML = `name: my-agent
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

maxSteps: 10
cooldownMs: 5000
`;

const PROJECT_YAML = `version: 1

agents:
  dir: ./agents

log:
  level: info

webSearch:
  provider: tavily
  apiKey: "\${TAVILY_API_KEY}"

fetchUrl:
  provider: jina
  # apiKey: "\${JINA_API_KEY}"  # optional — works without key (20 RPM), free key gets 500 RPM
`;

const PACKAGE_JSON = (name: string) => JSON.stringify({
  name,
  version: '0.1.0',
  type: 'module',
  private: true,
  dependencies: {
    'wa-agent': '^0.1.0',
  },
}, null, 2);

const TSCONFIG = JSON.stringify({
  compilerOptions: {
    target: 'ES2022',
    module: 'NodeNext',
    moduleResolution: 'NodeNext',
    strict: true,
    esModuleInterop: true,
    skipLibCheck: true,
    outDir: 'dist',
    rootDir: 'src',
  },
  include: ['src/**/*'],
  exclude: ['node_modules', 'dist'],
}, null, 2);

export async function initCommand(name: string): Promise<void> {
  const dir = join(process.cwd(), name);

  if (existsSync(dir)) {
    console.error(`Directory '${name}' already exists`);
    process.exit(1);
  }

  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, 'agents'), { recursive: true });
  mkdirSync(join(dir, 'tools'), { recursive: true });
  mkdirSync(join(dir, 'src'), { recursive: true });

  writeFileSync(join(dir, 'package.json'), PACKAGE_JSON(name));
  writeFileSync(join(dir, 'tsconfig.json'), TSCONFIG);
  writeFileSync(join(dir, 'wa-agent.yaml'), PROJECT_YAML);
  writeFileSync(join(dir, 'agents', 'my-agent.yaml'), AGENT_YAML);

  console.log(`\n  Created ${name}/`);
  console.log(`  ├── agents/my-agent.yaml`);
  console.log(`  ├── tools/`);
  console.log(`  ├── wa-agent.yaml`);
  console.log(`  ├── package.json`);
  console.log(`  └── tsconfig.json`);
  console.log(`\n  Next steps:`);
  console.log(`    cd ${name}`);
  console.log(`    npm install`);
  console.log(`    # Edit wa-agent.yaml with your API keys`);
  console.log(`    # Edit agents/my-agent.yaml with your agent config`);
  console.log(`    npx wa-agent start\n`);
}
