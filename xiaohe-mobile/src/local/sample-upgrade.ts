import { seedQuestions } from './shared/seed.ts';
import { cloneData } from './clone.ts';
import type { Question, WorkspaceState } from './types.ts';

const stable = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'undefined';
};

/** Upgrade only exact known sample content, never edited bank records.
 * Frozen papers and evidence keep their original versions and missing metadata. */
export function upgradeLocalSamples(state: WorkspaceState): { updated: number; added: number } {
  // Once an archive exists, content is explicitly managed. Never resurrect a
  // withdrawn/rolled-back item during a routine launch or sample migration.
  if (state.content) return { updated: 0, added: 0 };
  const published = seedQuestions();
  const replacements = new Map<string, Question>();
  for (const next of published) {
    const current = state.questions.find(q => q.id === next.id);
    if (!current || current.version !== 1) continue;
    const previous = { ...next, version: 1 };
    delete previous.taskType; delete previous.contextId;
    if (stable(current) === stable(previous)) replacements.set(next.id, next);
  }
  if (!replacements.size) return { updated: 0, added: 0 };
  state.questions = state.questions.map(q => cloneData(replacements.get(q.id) || q));
  const additions = published.filter(q => /^seed-(division|geometry|multiplication)-(9|10)$/.test(q.id) && !state.questions.some(existing => existing.id === q.id));
  state.questions.push(...cloneData(additions));
  return { updated: replacements.size, added: additions.length };
}
