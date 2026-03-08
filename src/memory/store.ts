import { getDb } from '@ibrahimwithi/wu-cli';

// --- Conversations ---

export interface ConversationRow {
  agent_name: string;
  chat_jid: string;
  summary: string | null;
  summaryUpToTimestamp: number | null;
}

export function getConversation(agentName: string, chatJid: string): ConversationRow | null {
  const db = getDb();
  const row = db.prepare(
    'SELECT agent_name, chat_jid, summary, summary_up_to_timestamp as summaryUpToTimestamp FROM agent_conversations WHERE agent_name = ? AND chat_jid = ?'
  ).get(agentName, chatJid) as ConversationRow | undefined;
  return row ?? null;
}

export function upsertConversation(agentName: string, chatJid: string, summary: string, summaryUpToTimestamp: number): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO agent_conversations (agent_name, chat_jid, summary, summary_up_to_timestamp, updated_at)
    VALUES (?, ?, ?, ?, unixepoch())
    ON CONFLICT(agent_name, chat_jid) DO UPDATE SET
      summary = excluded.summary,
      summary_up_to_timestamp = excluded.summary_up_to_timestamp,
      updated_at = unixepoch()
  `).run(agentName, chatJid, summary, summaryUpToTimestamp);
}

// --- User Profiles ---

export interface UserProfileRow {
  agent_name: string;
  user_jid: string;
  facts: string | null;
  preferences: string | null;
}

export function getUserProfileRow(agentName: string, userJid: string): UserProfileRow | null {
  const db = getDb();
  const row = db.prepare(
    'SELECT * FROM agent_user_profiles WHERE agent_name = ? AND user_jid = ?'
  ).get(agentName, userJid) as UserProfileRow | undefined;
  return row ?? null;
}

export function upsertUserProfile(agentName: string, userJid: string, facts: string, preferences: string): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO agent_user_profiles (agent_name, user_jid, facts, preferences, updated_at)
    VALUES (?, ?, ?, ?, unixepoch())
    ON CONFLICT(agent_name, user_jid) DO UPDATE SET
      facts = excluded.facts,
      preferences = excluded.preferences,
      updated_at = unixepoch()
  `).run(agentName, userJid, facts, preferences);
}

// --- Scheduled Tasks ---

export interface ScheduledTaskRow {
  id: number;
  agent_name: string;
  target: string;
  action: string;
  payload: string | null;
  next_run_at: number;
  is_recurring: number;
  cron_expression: string | null;
}

export function insertScheduledTask(task: {
  agentName: string;
  target: string;
  action: string;
  payload: string | null;
  nextRunAt: number;
  isRecurring: number;
  cronExpression: string | null;
}): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO agent_scheduled_tasks (agent_name, target, action, payload, next_run_at, is_recurring, cron_expression)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(task.agentName, task.target, task.action, task.payload, task.nextRunAt, task.isRecurring, task.cronExpression);
}

export function getDueTasks(now: number): ScheduledTaskRow[] {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM agent_scheduled_tasks WHERE next_run_at <= ?'
  ).all(now) as ScheduledTaskRow[];
}

export function deleteScheduledTask(id: number): void {
  const db = getDb();
  db.prepare('DELETE FROM agent_scheduled_tasks WHERE id = ?').run(id);
}

export function updateTaskNextRun(id: number, nextRunAt: number): void {
  const db = getDb();
  db.prepare('UPDATE agent_scheduled_tasks SET next_run_at = ? WHERE id = ?').run(nextRunAt, id);
}

export function deleteRecurringTasksForAgent(agentName: string): void {
  const db = getDb();
  db.prepare('DELETE FROM agent_scheduled_tasks WHERE agent_name = ? AND is_recurring = 1').run(agentName);
}

// --- Handoff State ---

export function getHandoffState(agentName: string, chatJid: string): boolean {
  const db = getDb();
  const row = db.prepare(
    'SELECT handed_off FROM agent_handoff_state WHERE agent_name = ? AND chat_jid = ?'
  ).get(agentName, chatJid) as { handed_off: number } | undefined;
  return row?.handed_off === 1;
}

export function getHandedOffChats(agentName: string): string[] {
  const db = getDb();
  const rows = db.prepare(
    'SELECT chat_jid FROM agent_handoff_state WHERE agent_name = ? AND handed_off = 1'
  ).all(agentName) as { chat_jid: string }[];
  return rows.map(r => r.chat_jid);
}

export function setHandoffState(agentName: string, chatJid: string, handedOff: boolean): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO agent_handoff_state (agent_name, chat_jid, handed_off, handed_off_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(agent_name, chat_jid) DO UPDATE SET
      handed_off = excluded.handed_off,
      handed_off_at = excluded.handed_off_at
  `).run(agentName, chatJid, handedOff ? 1 : 0, handedOff ? Math.floor(Date.now() / 1000) : null);
}
