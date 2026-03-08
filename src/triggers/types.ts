export interface SchedulerTask {
  id: number;
  agentName: string;
  target: string;
  action: string;
  payload: Record<string, unknown> | null;
  nextRunAt: number;
  isRecurring: boolean;
  cronExpression: string | null;
}
