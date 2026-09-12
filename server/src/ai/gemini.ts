// Gemini REST client — minimal, dependency-free.
// Uses node 20+ global fetch. We deliberately avoid @google/genai to keep
// the dependency surface small and pin the wire-format ourselves.
//
// API docs: https://ai.google.dev/api/generate-content
// Endpoint: POST /v1beta/models/{model}:generateContent

import { env } from '../env';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta';

export interface GenerateOptions {
  model?: string;
  system?: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}

export interface GenerateResult {
  text: string;
  model: string;
  finishReason?: string;
  promptTokens?: number;
  completionTokens?: number;
}

export class GeminiError extends Error {
  constructor(
    public readonly code: 'TIMEOUT' | 'BLOCKED' | 'UPSTREAM' | 'EMPTY',
    message: string,
    public readonly status?: number,
  ) {
    super(message);
  }
}

interface GeminiCandidate {
  content?: { parts?: { text?: string }[] };
  finishReason?: string;
}

interface GeminiResponse {
  candidates?: GeminiCandidate[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}

export async function generate(opts: GenerateOptions): Promise<GenerateResult> {
  const model = opts.model ?? env.GEMINI_MODEL;
  const timeoutMs = opts.timeoutMs ?? 8_000;
  const url = `${ENDPOINT}/models/${encodeURIComponent(model)}:generateContent?key=${env.GEMINI_API_KEY}`;

  const body = {
    contents: [{ role: 'user', parts: [{ text: opts.user }] }],
    ...(opts.system ? { systemInstruction: { parts: [{ text: opts.system }] } } : {}),
    generationConfig: {
      maxOutputTokens: opts.maxTokens ?? 128,
      temperature: opts.temperature ?? 0.2,
      candidateCount: 1,
      // Gemini 2.5 models reserve tokens for chain-of-thought ("thinking")
      // before emitting output. For short urgent prompts that's pure waste —
      // disable it so maxOutputTokens is all available to the answer.
      thinkingConfig: { thinkingBudget: 0 },
    },
    safetySettings: [
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' },
    ],
  };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  let resp: Response;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new GeminiError('TIMEOUT', `gemini request timed out after ${timeoutMs}ms`);
    }
    throw new GeminiError('UPSTREAM', `gemini fetch failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    clearTimeout(timer);
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new GeminiError('UPSTREAM', `gemini ${resp.status}: ${text.slice(0, 200)}`, resp.status);
  }

  const json = (await resp.json()) as GeminiResponse;

  if (json.promptFeedback?.blockReason) {
    throw new GeminiError('BLOCKED', `gemini blocked: ${json.promptFeedback.blockReason}`);
  }

  const candidate = json.candidates?.[0];
  const text = candidate?.content?.parts?.map((p) => p.text ?? '').join('').trim() ?? '';
  if (!text) {
    throw new GeminiError('EMPTY', `gemini returned no text (finish: ${candidate?.finishReason ?? 'unknown'})`);
  }

  return {
    text,
    model,
    finishReason: candidate?.finishReason,
    promptTokens: json.usageMetadata?.promptTokenCount,
    completionTokens: json.usageMetadata?.candidatesTokenCount,
  };
}
