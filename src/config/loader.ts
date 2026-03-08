import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { parse as parseYaml } from 'yaml';
import { AgentConfigSchema, ProjectConfigSchema, type ProjectConfig } from './schema.js';
import type { AgentConfig } from '../agent/types.js';
import { ConfigError } from '../util/errors.js';
import { createChildLogger } from '../util/logger.js';

const logger = createChildLogger('config');

/** Recursively interpolate ${VAR} patterns in string values */
function interpolateEnvVars(obj: unknown): unknown {
  if (typeof obj === 'string') {
    return obj.replace(/\$\{(\w+)\}/g, (_, varName) => {
      const val = process.env[varName];
      if (val === undefined) {
        logger.warn({ var: varName }, 'Environment variable not set');
        return '';
      }
      return val;
    });
  }
  if (Array.isArray(obj)) {
    return obj.map(interpolateEnvVars);
  }
  if (obj && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = interpolateEnvVars(value);
    }
    return result;
  }
  return obj;
}

export function loadProjectConfig(projectDir: string): ProjectConfig {
  const configPath = join(projectDir, 'wa-agent.yaml');
  if (!existsSync(configPath)) {
    throw new ConfigError(`Project config not found: ${configPath}`);
  }

  const raw = readFileSync(configPath, 'utf-8');
  const parsed = parseYaml(raw);
  const interpolated = interpolateEnvVars(parsed);
  return ProjectConfigSchema.parse(interpolated);
}

export function loadAgentConfig(filePath: string): AgentConfig {
  const raw = readFileSync(filePath, 'utf-8');
  const parsed = parseYaml(raw);
  const interpolated = interpolateEnvVars(parsed);
  const validated = AgentConfigSchema.parse(interpolated);
  return validated as AgentConfig;
}

export function loadAllAgentConfigs(projectDir: string, agentsDir: string): AgentConfig[] {
  const resolvedDir = resolve(projectDir, agentsDir);
  if (!existsSync(resolvedDir)) {
    throw new ConfigError(`Agents directory not found: ${resolvedDir}`);
  }

  const files = readdirSync(resolvedDir).filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));
  if (files.length === 0) {
    logger.warn({ dir: resolvedDir }, 'No agent configs found');
    return [];
  }

  const configs: AgentConfig[] = [];
  for (const file of files) {
    try {
      const config = loadAgentConfig(join(resolvedDir, file));
      configs.push(config);
      logger.info({ agent: config.name, file }, 'Loaded agent config');
    } catch (err) {
      throw new ConfigError(`Failed to load agent config '${file}': ${err}`);
    }
  }

  return configs;
}
