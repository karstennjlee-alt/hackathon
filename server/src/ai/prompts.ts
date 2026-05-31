// Typed prompt templates for Beacon5 AI tasks.
// Each task has a strict word/character budget and a deterministic
// fallback so the UI always renders something sensible even if Gemini
// fails, blocks, or times out.

export type AiTask = 'clarify-alert' | 'brief' | 'all-clear' | 'polish-broadcast';

export interface PromptSpec {
  system: string;
  user: string;
  maxTokens: number;
  temperature: number;
  // Post-processor — clamps length, strips quotes/markdown, enforces budget.
  finalize: (raw: string) => string;
  // Deterministic fallback when Gemini fails. Never throws.
  fallback: () => string;
}

// ─── shared helpers ───────────────────────────────────────────────

function stripChrome(s: string): string {
  return s
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/^\*+|\*+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function clampWords(s: string, max: number): string {
  const words = s.split(/\s+/).filter(Boolean);
  if (words.length <= max) return s;
  return words.slice(0, max).join(' ');
}

function clampChars(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max).trimEnd();
}

// ─── inputs ───────────────────────────────────────────────────────

export interface ClarifyAlertInput {
  studentLabel: string;     // e.g. "Student in Room 204"
  locationHint?: string;    // optional human-readable location
  context?: string;         // optional 1-line situational context
}

export interface BriefInput {
  incidentType: string;     // e.g. "Beacon activated"
  campusName: string;
  location?: string;
  staffOnScene?: number;
  studentsAffected?: number;
}

export interface AllClearInput {
  campusName: string;
  durationMin?: number;
}

export interface PolishBroadcastInput {
  draft: string;            // the staff's draft message
  audience: 'students' | 'parents' | 'staff' | 'everyone';
}

// ─── prompt builders ──────────────────────────────────────────────

export function clarifyAlertPrompt(input: ClarifyAlertInput): PromptSpec {
  const ctx = [
    `Subject: ${input.studentLabel}`,
    input.locationHint ? `Location: ${input.locationHint}` : null,
    input.context ? `Context: ${input.context}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  return {
    system:
      'You write urgent, neutral alert headlines for school staff. ' +
      'Output ONE sentence, at most 12 words. ' +
      'No emojis, no markdown, no quotes. No first-person. ' +
      'Use plain, direct language. Never speculate beyond the facts given.',
    user: `Write a 12-word headline alert for staff.\n\n${ctx}`,
    maxTokens: 48,
    temperature: 0.2,
    finalize: (raw) => clampWords(stripChrome(raw), 12),
    fallback: () => {
      const loc = input.locationHint ? ` at ${input.locationHint}` : '';
      return clampWords(`Alert: ${input.studentLabel}${loc} needs assistance.`, 12);
    },
  };
}

export function briefPrompt(input: BriefInput): PromptSpec {
  const ctx = [
    `Campus: ${input.campusName}`,
    `Type: ${input.incidentType}`,
    input.location ? `Location: ${input.location}` : null,
    typeof input.staffOnScene === 'number' ? `Staff on scene: ${input.staffOnScene}` : null,
    typeof input.studentsAffected === 'number' ? `Students affected: ${input.studentsAffected}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  return {
    system:
      'You write incident command briefings for school administrators. ' +
      'Output ONE sentence, at most 22 words. ' +
      'No emojis, no markdown, no quotes. ' +
      'Lead with the most operationally important fact. Be specific. Never speculate.',
    user: `Write a 22-word commander brief.\n\n${ctx}`,
    maxTokens: 96,
    temperature: 0.2,
    finalize: (raw) => clampWords(stripChrome(raw), 22),
    fallback: () => {
      const loc = input.location ? ` at ${input.location}` : '';
      return clampWords(`${input.incidentType}${loc} on ${input.campusName} — staff responding, status updating.`, 22);
    },
  };
}

export function allClearPrompt(input: AllClearInput): PromptSpec {
  const dur = typeof input.durationMin === 'number' ? `Duration: ${input.durationMin} minutes` : '';
  return {
    system:
      'You write reassuring all-clear announcements for a school campus. ' +
      'Output ONE sentence, at most 20 words. ' +
      'Tone: calm, factual, warm. No emojis. No markdown. No quotes. ' +
      'Avoid alarming language.',
    user: `Write an all-clear announcement for ${input.campusName}.\n${dur}`,
    maxTokens: 80,
    temperature: 0.3,
    finalize: (raw) => clampWords(stripChrome(raw), 20),
    fallback: () =>
      clampWords(
        `All clear at ${input.campusName}. Normal operations resume now. Thank you for your cooperation.`,
        20,
      ),
  };
}

export function polishBroadcastPrompt(input: PolishBroadcastInput): PromptSpec {
  return {
    system:
      'You polish urgent broadcasts written by school staff. ' +
      'Keep the meaning EXACTLY the same. Fix grammar, clarity, and tone only. ' +
      'Output at most 280 characters. No emojis, markdown, or quotes. ' +
      'Match the audience: students=plain, parents=calm, staff=operational, everyone=neutral.',
    user: `Audience: ${input.audience}\n\nDraft:\n${input.draft}\n\nRewrite the draft, preserving meaning.`,
    maxTokens: 220,
    temperature: 0.3,
    finalize: (raw) => clampChars(stripChrome(raw), 280),
    fallback: () => clampChars(input.draft.trim(), 280),
  };
}
