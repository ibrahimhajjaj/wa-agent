import { generateText } from 'ai';
import type { AgentInstance } from '../agent/types.js';
import type { GenerateTextResult } from 'ai';
import { getUserProfileRow, upsertUserProfile } from './store.js';
import { createChildLogger } from '../util/logger.js';

const logger = createChildLogger('profiles');

export interface UserProfile {
  facts: string | null;
  preferences: string | null;
}

export function getUserProfile(agentName: string, userJid: string): UserProfile | null {
  const row = getUserProfileRow(agentName, userJid);
  if (!row) return null;
  return { facts: row.facts, preferences: row.preferences };
}

const PROFILE_PROMPT = `Analyze this conversation and extract any NEW facts about the user.
Return a JSON object with two fields:
- "newFacts": array of new factual observations (e.g., "Lives in Dubai", "Prefers morning meetings")
- "preferences": object of preferences (e.g., {"language": "en", "tone": "casual"})

Only include genuinely new information. If nothing new, return {"newFacts": [], "preferences": {}}.
Return ONLY the JSON, no other text.`;

export async function maybeUpdateUserProfile(
  agent: AgentInstance,
  userJid: string,
  conversationResult: GenerateTextResult<any, any>,
): Promise<void> {
  if (!agent.config.memory.userProfiles) return;

  // Only run profile extraction occasionally (every 5th interaction approximately)
  if (Math.random() > 0.2) return;

  const existing = getUserProfileRow(agent.config.name, userJid);
  const existingFacts = existing?.facts || '[]';
  const existingPrefs = existing?.preferences || '{}';

  // Build a summary of recent interaction for analysis
  const recentText = conversationResult.text || '';
  if (recentText.length < 20) return; // Too short to extract meaningful info

  try {
    const result = await generateText({
      model: agent.model,
      messages: [
        { role: 'system', content: PROFILE_PROMPT },
        {
          role: 'user',
          content: `Existing facts: ${existingFacts}\nExisting preferences: ${existingPrefs}\n\nRecent interaction:\n${recentText}`,
        },
      ],
    });

    const parsed = JSON.parse(result.text);
    if (!parsed.newFacts?.length && !Object.keys(parsed.preferences || {}).length) return;

    // Merge facts
    let facts: string[];
    try {
      facts = JSON.parse(existingFacts);
    } catch {
      facts = [];
    }
    facts.push(...(parsed.newFacts || []));
    // Deduplicate and cap at 50 facts
    facts = [...new Set(facts)].slice(0, 50);

    // Merge preferences
    let prefs: Record<string, unknown>;
    try {
      prefs = JSON.parse(existingPrefs);
    } catch {
      prefs = {};
    }
    Object.assign(prefs, parsed.preferences || {});

    upsertUserProfile(agent.config.name, userJid, JSON.stringify(facts), JSON.stringify(prefs));
    logger.debug({ agent: agent.config.name, userJid, newFacts: parsed.newFacts?.length }, 'Updated user profile');
  } catch (err) {
    logger.error({ err, agent: agent.config.name, userJid }, 'Failed to extract profile');
  }
}
