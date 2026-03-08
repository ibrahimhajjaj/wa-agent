#!/usr/bin/env node

import { Command } from 'commander';
import { startCommand } from './start.js';
import { devCommand } from './dev.js';
import { initCommand } from './init.js';
import { agentsCommand } from './agents.js';

const program = new Command();

program
  .name('wa-agent')
  .description('Framework for building autonomous AI agents on WhatsApp')
  .version('0.1.0');

program
  .command('init <name>')
  .description('Scaffold a new wa-agent project')
  .action(initCommand);

program
  .command('start')
  .description('Start the agent engine')
  .option('-d, --dir <path>', 'Project directory', '.')
  .action(startCommand);

program
  .command('dev')
  .description('Start with hot-reload (watches agent YAML files)')
  .option('-d, --dir <path>', 'Project directory', '.')
  .action(devCommand);

const agents = program
  .command('agents')
  .description('Manage agents');

agents
  .command('list')
  .description('List configured agents')
  .option('-d, --dir <path>', 'Project directory', '.')
  .action(agentsCommand);

program.parse();
