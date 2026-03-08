import { ReconnectingConnection, startListener, loadConfig as loadWuConfig } from '@ibrahimwithi/wu-cli';
import type { WASocket } from '@whiskeysockets/baileys';
import type { ParsedMessage } from '@ibrahimwithi/wu-cli';
import { loadProjectConfig, loadAllAgentConfigs } from '../config/loader.js';
import { initMemorySchema } from '../memory/schema.js';
import { loadCustomTools } from '../tools/registry.js';
import { createAgentInstance, destroyAllAgents } from './lifecycle.js';
import { Router } from './router.js';
import { Dispatcher } from './dispatcher.js';
import { MiddlewarePipeline } from '../middleware/pipeline.js';
import { createFilterMiddleware } from '../middleware/filter.js';
import { createHandoffCheckMiddleware } from '../middleware/handoff-check.js';
import { Scheduler } from '../triggers/scheduler.js';
import { createChildLogger } from '../util/logger.js';

const logger = createChildLogger('engine');

export class Engine {
  private connection: ReconnectingConnection | null = null;
  private router = new Router();
  private dispatcher: Dispatcher | null = null;
  private pipeline = new MiddlewarePipeline();
  private scheduler: Scheduler | null = null;
  private projectDir: string;

  constructor(projectDir: string) {
    this.projectDir = projectDir;
  }

  async start(): Promise<void> {
    // 1. Load configs
    const projectConfig = loadProjectConfig(this.projectDir);
    const wuConfig = loadWuConfig();
    const agentConfigs = loadAllAgentConfigs(this.projectDir, projectConfig.agents.dir);

    // 2. Load custom tools from project's tools/ directory
    await loadCustomTools(this.projectDir);

    // 3. Init memory schema BEFORE anything else
    initMemorySchema();
    logger.info('Memory schema initialized');

    // 4. Create agent instances and register with router
    for (const config of agentConfigs) {
      const instance = createAgentInstance(config);
      this.router.register(config, instance);
    }
    logger.info({ count: agentConfigs.length }, 'Agents registered');

    // 5. Setup middleware pipeline
    this.pipeline.use('filter', createFilterMiddleware());
    this.pipeline.use('handoff-check', createHandoffCheckMiddleware(() => this.router.getAgentNames()));

    // 6. Start connection
    this.connection = new ReconnectingConnection({
      isDaemon: true,
      quiet: false,
      onReady: (sock) => {
        logger.info('WhatsApp connection ready');
        if (this.dispatcher) {
          this.dispatcher.updateSock(sock);
        } else {
          this.dispatcher = new Dispatcher(sock, wuConfig, projectConfig);
        }

        // Start listener
        startListener(sock, {
          config: wuConfig,
          onMessage: (msg) => this.onMessage(msg),
        });

        // Start scheduler
        if (this.scheduler) {
          this.scheduler.updateSock(sock);
        } else {
          this.scheduler = new Scheduler(sock, wuConfig, projectConfig);
          this.scheduler.start();
        }
      },
      onDisconnect: () => {
        logger.warn('WhatsApp disconnected');
      },
      onFatal: (reason) => {
        logger.error({ reason }, 'Fatal connection error');
        this.stop().then(() => process.exit(1));
      },
    });

    const sock = await this.connection.start();
    logger.info('Engine started');

    // 7. Register scheduled triggers from agent configs
    if (this.scheduler) {
      for (const config of agentConfigs) {
        if (config.triggers?.length) {
          await this.scheduler.registerTriggers(config);
        }
      }
    }
  }

  private onMessage(msg: ParsedMessage): void {
    // Run through middleware pipeline
    if (!this.pipeline.run(msg)) return;

    // Route to agent
    const agent = this.router.resolve(msg);
    if (!agent) {
      logger.debug({ chatJid: msg.chatJid }, 'No agent matched');
      return;
    }

    // Dispatch
    this.dispatcher?.dispatch(msg, agent);
  }

  async stop(): Promise<void> {
    logger.info('Stopping engine...');

    // 1. Stop scheduler
    this.scheduler?.stop();

    // 2. Drain all chat queues
    if (this.dispatcher) {
      await this.dispatcher.getChatQueue().drainAll();
    }

    // 3. Destroy all agents
    destroyAllAgents();

    // 4. Close connection
    if (this.connection) {
      await this.connection.stop();
    }

    logger.info('Engine stopped');
  }

  getRouter(): Router {
    return this.router;
  }

  getDispatcher(): Dispatcher | null {
    return this.dispatcher;
  }
}
