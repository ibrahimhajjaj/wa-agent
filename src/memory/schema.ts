import { getDb } from '@ibrahimwithi/wu-cli';

export function initMemorySchema(): void {
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_conversations (
      agent_name TEXT NOT NULL,
      chat_jid TEXT NOT NULL,
      summary TEXT,
      summary_up_to_timestamp INTEGER,
      updated_at INTEGER DEFAULT (unixepoch()),
      PRIMARY KEY (agent_name, chat_jid)
    );

    CREATE TABLE IF NOT EXISTS agent_user_profiles (
      agent_name TEXT NOT NULL,
      user_jid TEXT NOT NULL,
      facts TEXT,
      preferences TEXT,
      updated_at INTEGER DEFAULT (unixepoch()),
      PRIMARY KEY (agent_name, user_jid)
    );

    CREATE TABLE IF NOT EXISTS agent_scheduled_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_name TEXT NOT NULL,
      target TEXT NOT NULL,
      action TEXT NOT NULL,
      payload TEXT,
      next_run_at INTEGER NOT NULL,
      is_recurring INTEGER NOT NULL DEFAULT 0,
      cron_expression TEXT
    );

    CREATE TABLE IF NOT EXISTS agent_handoff_state (
      agent_name TEXT NOT NULL,
      chat_jid TEXT NOT NULL,
      handed_off INTEGER NOT NULL DEFAULT 0,
      handed_off_at INTEGER,
      PRIMARY KEY (agent_name, chat_jid)
    );
  `);
}
