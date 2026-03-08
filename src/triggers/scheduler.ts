import type { WASocket } from '@whiskeysockets/baileys';
import type { WuConfig } from '@ibrahimwithi/wu-cli';
import type { ProjectConfig } from '../config/schema.js';
import type { AgentConfig } from '../agent/types.js';
import type { ToolContext } from '../tools/types.js';
import { getDueTasks, deleteScheduledTask, updateTaskNextRun, insertScheduledTask, deleteRecurringTasksForAgent } from '../memory/store.js';
import { resolveTools } from '../tools/registry.js';
import { getAgentInstance } from '../runtime/lifecycle.js';
import { createChildLogger } from '../util/logger.js';

const logger = createChildLogger('scheduler');

// Use dynamic import for cron-parser ESM
let parseExpression: ((expr: string) => { next: () => { toDate: () => Date } }) | null = null;

async function getCronParser() {
  if (!parseExpression) {
    const mod = await import('cron-parser');
    parseExpression = mod.parseExpression ?? (mod as any).default?.parseExpression;
  }
  return parseExpression!;
}

export class Scheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;

  constructor(
    private sock: WASocket,
    private wuConfig: WuConfig,
    private projectConfig: ProjectConfig,
  ) {}

  start(): void {
    this.timer = setInterval(() => this.tick(), 60_000);
    // Immediate first tick
    this.tick();
    logger.info('Scheduler started');
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    logger.info('Scheduler stopped');
  }

  updateSock(sock: WASocket): void {
    this.sock = sock;
  }

  async registerTriggers(config: AgentConfig): Promise<void> {
    if (!config.triggers) return;

    const parser = await getCronParser();

    // Delete existing recurring tasks for this agent to prevent duplicates
    deleteRecurringTasksForAgent(config.name);

    for (const trigger of config.triggers) {
      if (trigger.type !== 'cron') continue;

      try {
        const interval = parser(trigger.schedule);
        const nextRun = Math.floor(interval.next().toDate().getTime() / 1000);

        insertScheduledTask({
          agentName: config.name,
          target: trigger.target,
          action: trigger.action,
          payload: trigger.payload ? JSON.stringify(trigger.payload) : null,
          nextRunAt: nextRun,
          isRecurring: 1,
          cronExpression: trigger.schedule,
        });

        logger.info({ agent: config.name, schedule: trigger.schedule, nextRun }, 'Registered cron trigger');
      } catch (err) {
        logger.error({ err, agent: config.name, schedule: trigger.schedule }, 'Invalid cron expression');
      }
    }
  }

  private async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;

    try {
      const now = Math.floor(Date.now() / 1000);
      const dueTasks = getDueTasks(now);

      for (const task of dueTasks) {
        try {
          logger.info({ taskId: task.id, agent: task.agent_name, action: task.action }, 'Executing scheduled task');

          const payload = task.payload ? JSON.parse(task.payload) : {};

          // Look up agent instance
          const agent = getAgentInstance(task.agent_name);
          if (!agent) {
            logger.warn({ taskId: task.id, agent: task.agent_name }, 'Agent not found, skipping task');
            continue;
          }

          // Construct scheduler ToolContext
          const schedulerCtx: ToolContext = {
            chatJid: task.target,
            senderJid: null,
            senderName: null,
            messageId: `sched-${task.id}-${Date.now()}`,
            agentConfig: agent.config,
            sock: this.sock,
            config: this.wuConfig,
            projectConfig: this.projectConfig,
          };

          // Resolve and execute tool
          try {
            const tools = resolveTools([task.action], schedulerCtx);
            const resolvedTool = tools[task.action];
            if (resolvedTool && 'execute' in resolvedTool && typeof resolvedTool.execute === 'function') {
              await resolvedTool.execute(payload, {
                toolCallId: `sched-${task.id}-${Date.now()}`,
                messages: [],
              });
            } else {
              logger.warn({ taskId: task.id, action: task.action }, 'Tool has no execute function');
            }
          } catch (toolErr) {
            logger.error({ err: toolErr, taskId: task.id, action: task.action }, 'Tool execution failed');
          }

          // Handle recurring vs one-shot AFTER execution
          if (task.is_recurring && task.cron_expression) {
            const parser = await getCronParser();
            const interval = parser(task.cron_expression);
            const nextRun = Math.floor(interval.next().toDate().getTime() / 1000);
            updateTaskNextRun(task.id, nextRun);
          } else {
            deleteScheduledTask(task.id);
          }
        } catch (err) {
          logger.error({ err, taskId: task.id }, 'Failed to execute scheduled task');
        }
      }
    } finally {
      this.ticking = false;
    }
  }
}
