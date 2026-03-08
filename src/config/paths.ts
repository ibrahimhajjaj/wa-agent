import { homedir } from 'os';
import { join, resolve } from 'path';
import { mkdirSync } from 'fs';

export const WA_AGENT_HOME = process.env.WA_AGENT_HOME || join(homedir(), '.wa-agent');

export function ensureWaAgentHome(): void {
  mkdirSync(WA_AGENT_HOME, { recursive: true });
}

export function resolveProjectPath(base: string, relative: string): string {
  return resolve(base, relative);
}
