// /v1/incidents — student beacon activation + staff verification.
//
// Routes:
//   POST   /v1/incidents              — student activates a beacon
//   POST   /v1/incidents/:id/clear    — staff/admin marks cleared (verify perm)
//   POST   /v1/incidents/:id/location — student streams a GPS point
//
// All writes go through `admin` (service_role) so RLS is bypassed.
// The app-layer permission gates in routes.ts and the JWT campus claim
// are the authoritative access checks (defense in depth: RLS still
// applies to reads from app/admin clients).

import type { Request, Response } from 'express';
import { z } from 'zod';
import { admin } from '../supabase';
import { ApiError, parseBody } from '../http';
import { audit } from '../audit';

const CoordsSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy: z.number().nonnegative().max(100_000).optional(),
});

const ActivateBody = z.object({
  escalation: z
    .object({
      kind: z.enum(['threat', 'medical', 'unspecified']).default('unspecified'),
      presets: z.array(z.string().max(40)).max(8).default([]),
      rawNote: z.string().max(500).default(''),
      clarifiedNote: z.string().max(500).optional(),
    })
    .default({ kind: 'unspecified', presets: [], rawNote: '' }),
  lastKnownCoords: CoordsSchema.optional(),
  zoneHint: z.string().max(120).optional(),
});

const LocationBody = z.object({
  coords: CoordsSchema,
});

function requireCampus(req: Request): { campusId: string; uid: string; role: string } {
  const campusId = req.user?.app_metadata?.campus_id;
  const role = req.user?.app_metadata?.role;
  const uid = req.user?.sub;
  if (!campusId || !role || !uid) {
    throw new ApiError(403, 'NOT_MEMBER', 'caller is not a campus member');
  }
  return { campusId, uid, role };
}

// ─── POST /v1/incidents ───────────────────────────────────────────
export async function postActivateIncident(req: Request, res: Response): Promise<void> {
  const { campusId, uid, role } = requireCampus(req);
  if (role !== 'student' && role !== 'staff' && role !== 'admin') {
    throw new ApiError(403, 'FORBIDDEN', 'parents cannot activate the beacon');
  }
  const body = parseBody(ActivateBody, req.body ?? {});

  // Refuse if this student already has an active incident — one at a time.
  const { data: existing, error: lookupErr } = await admin
    .from('incidents')
    .select('id')
    .eq('campus_id', campusId)
    .eq('student_user_id', uid)
    .eq('status', 'active')
    .maybeSingle();
  if (lookupErr) throw new Error(`incidents lookup: ${lookupErr.message}`);
  if (existing) {
    res.status(200).json({ id: existing.id, alreadyActive: true });
    return;
  }

  const { data: inserted, error: insertErr } = await admin
    .from('incidents')
    .insert({
      campus_id: campusId,
      student_user_id: uid,
      status: 'active',
      escalation: body.escalation,
      last_known_coords: body.lastKnownCoords ?? null,
      zone_hint: body.zoneHint ?? null,
    })
    .select('id, activated_at')
    .single();
  if (insertErr || !inserted) {
    throw new Error(`incidents insert: ${insertErr?.message ?? 'no row returned'}`);
  }

  await audit({
    campusId,
    actorUserId: uid,
    action: 'incident.activate',
    target: inserted.id,
    metadata: { kind: body.escalation.kind },
  });

  res.status(201).json({
    id: inserted.id,
    activatedAt: new Date(inserted.activated_at).getTime(),
  });
}

// ─── POST /v1/incidents/:id/clear ─────────────────────────────────
export async function postClearIncident(req: Request, res: Response): Promise<void> {
  const { campusId, uid } = requireCampus(req);
  const id = req.params.id;
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    throw new ApiError(400, 'BAD_REQUEST', 'incident id is not a uuid', 'id');
  }

  const { data: row, error: lookupErr } = await admin
    .from('incidents')
    .select('id, campus_id, status')
    .eq('id', id)
    .maybeSingle();
  if (lookupErr) throw new Error(`incidents lookup: ${lookupErr.message}`);
  if (!row) throw new ApiError(404, 'NOT_FOUND', 'incident not found');
  if (row.campus_id !== campusId) throw new ApiError(403, 'FORBIDDEN', 'incident is on a different campus');
  if (row.status === 'cleared') {
    res.json({ id, status: 'cleared', alreadyCleared: true });
    return;
  }

  const clearedAtIso = new Date().toISOString();
  const { error: updErr } = await admin
    .from('incidents')
    .update({ status: 'cleared', cleared_at: clearedAtIso })
    .eq('id', id)
    .eq('status', 'active');
  if (updErr) throw new Error(`incidents update: ${updErr.message}`);

  await audit({
    campusId,
    actorUserId: uid,
    action: 'incident.clear',
    target: id,
  });

  res.json({ id, status: 'cleared', clearedAt: new Date(clearedAtIso).getTime() });
}

// ─── POST /v1/incidents/:id/location ──────────────────────────────
export async function postIncidentLocation(req: Request, res: Response): Promise<void> {
  const { campusId, uid } = requireCampus(req);
  const id = req.params.id;
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    throw new ApiError(400, 'BAD_REQUEST', 'incident id is not a uuid', 'id');
  }
  const body = parseBody(LocationBody, req.body);

  const { data: row, error: lookupErr } = await admin
    .from('incidents')
    .select('id, campus_id, student_user_id, status')
    .eq('id', id)
    .maybeSingle();
  if (lookupErr) throw new Error(`incidents lookup: ${lookupErr.message}`);
  if (!row) throw new ApiError(404, 'NOT_FOUND', 'incident not found');
  if (row.campus_id !== campusId) throw new ApiError(403, 'FORBIDDEN', 'incident is on a different campus');
  if (row.student_user_id !== uid) {
    throw new ApiError(403, 'FORBIDDEN', 'only the incident owner streams location');
  }
  if (row.status !== 'active') {
    throw new ApiError(409, 'INCIDENT_NOT_ACTIVE', 'incident is no longer active');
  }

  const { error: insertErr } = await admin.from('location_points').insert({
    campus_id: campusId,
    incident_id: id,
    student_user_id: uid,
    coords: body.coords,
  });
  if (insertErr) throw new Error(`location_points insert: ${insertErr.message}`);

  await admin
    .from('incidents')
    .update({ last_known_coords: body.coords })
    .eq('id', id);

  res.status(204).end();
}
