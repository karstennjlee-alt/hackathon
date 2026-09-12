// AI route handlers — every Gemini call lives behind these endpoints.
// Clients (the app, the admin console) MUST NOT call Gemini directly.
//
// Auth: verifyToken + requireCampusMember (run by index.ts).
// Output: { text, source, model? } — `source` lets the client log
// whether the primary, fallback model, or deterministic template was used.

import { z } from 'zod';
import type { Request, Response } from 'express';
import { parseBody } from '../http';
import { runPrompt } from './provider';
import {
  clarifyAlertPrompt,
  briefPrompt,
  allClearPrompt,
  polishBroadcastPrompt,
} from './prompts';

const ClarifyBody = z.object({
  studentLabel: z.string().min(1).max(120),
  locationHint: z.string().max(120).optional(),
  context: z.string().max(280).optional(),
});

const BriefBody = z.object({
  incidentType: z.string().min(1).max(80),
  campusName: z.string().min(1).max(120),
  location: z.string().max(120).optional(),
  staffOnScene: z.number().int().nonnegative().max(9999).optional(),
  studentsAffected: z.number().int().nonnegative().max(99999).optional(),
});

const AllClearBody = z.object({
  campusName: z.string().min(1).max(120),
  durationMin: z.number().int().nonnegative().max(24 * 60).optional(),
});

const PolishBody = z.object({
  draft: z.string().min(1).max(1_000),
  audience: z.enum(['students', 'parents', 'staff', 'everyone']),
});

export async function postClarifyAlert(req: Request, res: Response): Promise<void> {
  const body = parseBody(ClarifyBody, req.body);
  const outcome = await runPrompt(clarifyAlertPrompt(body));
  res.json(outcome);
}

export async function postBrief(req: Request, res: Response): Promise<void> {
  const body = parseBody(BriefBody, req.body);
  const outcome = await runPrompt(briefPrompt(body));
  res.json(outcome);
}

export async function postAllClear(req: Request, res: Response): Promise<void> {
  const body = parseBody(AllClearBody, req.body);
  const outcome = await runPrompt(allClearPrompt(body));
  res.json(outcome);
}

export async function postPolishBroadcast(req: Request, res: Response): Promise<void> {
  const body = parseBody(PolishBody, req.body);
  const outcome = await runPrompt(polishBroadcastPrompt(body));
  res.json(outcome);
}
