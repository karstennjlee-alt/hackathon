// Provider-agnostic AI wrapper with a fallback chain:
//   primary model  →  secondary model  →  deterministic template
//
// The route handlers should never throw on AI failure — they should
// always return SOMETHING for the UI, with a `source` field telling
// the client whether the text came from the primary model, a fallback
// model, or the deterministic template.

import { generate, GeminiError } from './gemini';
import type { PromptSpec } from './prompts';
import { env } from '../env';

export type AiSource = 'primary' | 'fallback' | 'template';

export interface AiOutcome {
  text: string;
  source: AiSource;
  model?: string;
  finishReason?: string;
  promptTokens?: number;
  completionTokens?: number;
  // When the LLM was used but failed, we surface why so the client
  // can log/telemetry it. Not user-facing.
  notes?: string[];
}

// The default secondary is gemini-2.5-flash-lite — cheaper, faster,
// good enough for retries when the primary errors or times out.
const SECONDARY_MODEL = 'gemini-2.5-flash-lite';

export async function runPrompt(spec: PromptSpec): Promise<AiOutcome> {
  const notes: string[] = [];

  // Try primary.
  try {
    const r = await generate({
      system: spec.system,
      user: spec.user,
      maxTokens: spec.maxTokens,
      temperature: spec.temperature,
      model: env.GEMINI_MODEL,
    });
    return {
      text: spec.finalize(r.text),
      source: 'primary',
      model: r.model,
      finishReason: r.finishReason,
      promptTokens: r.promptTokens,
      completionTokens: r.completionTokens,
    };
  } catch (err) {
    notes.push(`primary: ${err instanceof GeminiError ? err.code : 'ERR'} ${err instanceof Error ? err.message : String(err)}`);
  }

  // Try secondary — only if it's actually a different model.
  if (SECONDARY_MODEL !== env.GEMINI_MODEL) {
    try {
      const r = await generate({
        system: spec.system,
        user: spec.user,
        maxTokens: spec.maxTokens,
        temperature: spec.temperature,
        model: SECONDARY_MODEL,
      });
      return {
        text: spec.finalize(r.text),
        source: 'fallback',
        model: r.model,
        finishReason: r.finishReason,
        promptTokens: r.promptTokens,
        completionTokens: r.completionTokens,
        notes,
      };
    } catch (err) {
      notes.push(`fallback: ${err instanceof GeminiError ? err.code : 'ERR'} ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Deterministic template — never throws.
  return {
    text: spec.fallback(),
    source: 'template',
    notes,
  };
}
