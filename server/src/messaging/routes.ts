// /v1/messages — chat (incident-scoped) + mass (campus-wide broadcast).
//
// Routes:
//   POST /v1/messages/chat — sender writes to a specific student's incident thread
//   POST /v1/messages/mass — sender broadcasts to an audience (students/parents/staff/everyone)
//
// Permission layering (in addition to verifyToken + requireCampusMember):
//   chat:  any campus member may send (chat:send)
//   mass:  audience='everyone' requires broadcast:send-everyone
//          else requires broadcast:send-staff-scoped
//
// Messages are IMMUTABLE — no update/delete routes. Retractions land
// as a new 'broadcast' message referencing the superseded id (later).

import type { Request, Response } from 'express';
import { z } from 'zod';
import { admin } from '../supabase';
import { ApiError, parseBody } from '../http';
import { audit } from '../audit';
import { hasPermission } from '../rbac/permissions';
import type { Role } from '@beacon5/shared';

const ChatBody = z.object({
  studentUserId: z.string().uuid(),
  body: z.string().min(1).max(2_000),
  clarifiedBody: z.string().max(2_000).optional(),
});

const MassBody = z.object({
  audience: z
    .array(z.enum(['students', 'parents', 'teachers', 'everyone']))
    .min(1)
    .max(4),
  body: z.string().min(1).max(2_000),
  clarifiedBody: z.string().max(2_000).optional(),
});

const BroadcastBody = z.object({
  studentUserId: z.string().uuid(),
  body: z.string().min(1).max(2_000),
  clarifiedBody: z.string().max(2_000).optional(),
});

function callerRole(req: Request): Role | null {
  const r = req.user?.app_metadata?.role;
  if (r === 'student' || r === 'parent' || r === 'staff' || r === 'admin') return r;
  return null;
}

function requireCampus(req: Request): { campusId: string; uid: string; role: Role } {
  const campusId = req.user?.app_metadata?.campus_id;
  const role = callerRole(req);
  const uid = req.user?.sub;
  if (!campusId || !role || !uid) {
    throw new ApiError(403, 'NOT_MEMBER', 'caller is not a campus member');
  }
  return { campusId, uid, role };
}

// ─── POST /v1/messages/chat ───────────────────────────────────────
export async function postChatMessage(req: Request, res: Response): Promise<void> {
  const { campusId, uid, role } = requireCampus(req);
  if (!hasPermission(role, 'chat:send')) {
    throw new ApiError(403, 'FORBIDDEN', `role ${role} cannot send chat messages`);
  }
  const body = parseBody(ChatBody, req.body);

  // Verify the target student is actually on this campus.
  const { data: student, error: studentErr } = await admin
    .from('users')
    .select('id, campus_id, role')
    .eq('id', body.studentUserId)
    .maybeSingle();
  if (studentErr) throw new Error(`users lookup: ${studentErr.message}`);
  if (!student || student.campus_id !== campusId) {
    throw new ApiError(404, 'NOT_FOUND', 'student not found on this campus');
  }

  // Parents can only chat about a linked student.
  if (role === 'parent') {
    const { data: link, error: linkErr } = await admin
      .from('guardian_links')
      .select('id, verified')
      .eq('campus_id', campusId)
      .eq('guardian_user_id', uid)
      .eq('student_user_id', body.studentUserId)
      .eq('verified', true)
      .maybeSingle();
    if (linkErr) throw new Error(`guardian_links lookup: ${linkErr.message}`);
    if (!link) throw new ApiError(403, 'FORBIDDEN', 'no verified guardian link to this student');
  }

  const { data: inserted, error: insertErr } = await admin
    .from('messages')
    .insert({
      campus_id: campusId,
      kind: 'chat',
      sender_user_id: uid,
      sender_role: role,
      student_user_id: body.studentUserId,
      body: body.body,
      clarified_body: body.clarifiedBody ?? null,
    })
    .select('id, at')
    .single();
  if (insertErr || !inserted) {
    throw new Error(`messages insert: ${insertErr?.message ?? 'no row returned'}`);
  }

  await audit({
    campusId,
    actorUserId: uid,
    action: 'message.chat',
    target: inserted.id,
    metadata: { studentUserId: body.studentUserId },
  });

  res.status(201).json({
    id: inserted.id,
    at: new Date(inserted.at).getTime(),
  });
}

// ─── POST /v1/messages/mass ───────────────────────────────────────
export async function postMassMessage(req: Request, res: Response): Promise<void> {
  const { campusId, uid, role } = requireCampus(req);
  const body = parseBody(MassBody, req.body);

  const wantsEveryone = body.audience.includes('everyone');
  const needed = wantsEveryone ? 'broadcast:send-everyone' : 'broadcast:send-staff-scoped';
  if (!hasPermission(role, needed)) {
    throw new ApiError(403, 'FORBIDDEN', `role ${role} cannot ${needed}`);
  }

  const { data: inserted, error: insertErr } = await admin
    .from('messages')
    .insert({
      campus_id: campusId,
      kind: 'mass',
      sender_user_id: uid,
      sender_role: role,
      audience: body.audience,
      body: body.body,
      clarified_body: body.clarifiedBody ?? null,
    })
    .select('id, at')
    .single();
  if (insertErr || !inserted) {
    throw new Error(`messages insert: ${insertErr?.message ?? 'no row returned'}`);
  }

  await audit({
    campusId,
    actorUserId: uid,
    action: 'message.mass',
    target: inserted.id,
    metadata: { audience: body.audience },
  });

  res.status(201).json({
    id: inserted.id,
    at: new Date(inserted.at).getTime(),
  });
}

// ─── POST /v1/messages/broadcast ─────────────────────────────────
// Staff/admin all-clear or status update tied to one student's incident.
// Schema-wise this is messages(kind='broadcast'); the v1 monolith renders
// it as STAFF_BROADCAST with kind='all_clear'|'update'.
export async function postBroadcastMessage(req: Request, res: Response): Promise<void> {
  const { campusId, uid, role } = requireCampus(req);
  if (role !== 'staff' && role !== 'admin') {
    throw new ApiError(403, 'FORBIDDEN', `role ${role} cannot send staff broadcasts`);
  }
  const body = parseBody(BroadcastBody, req.body);

  const { data: student, error: studentErr } = await admin
    .from('users')
    .select('id, campus_id')
    .eq('id', body.studentUserId)
    .maybeSingle();
  if (studentErr) throw new Error(`users lookup: ${studentErr.message}`);
  if (!student || student.campus_id !== campusId) {
    throw new ApiError(404, 'NOT_FOUND', 'student not found on this campus');
  }

  const { data: inserted, error: insertErr } = await admin
    .from('messages')
    .insert({
      campus_id: campusId,
      kind: 'broadcast',
      sender_user_id: uid,
      sender_role: role,
      student_user_id: body.studentUserId,
      body: body.body,
      clarified_body: body.clarifiedBody ?? null,
    })
    .select('id, at')
    .single();
  if (insertErr || !inserted) {
    throw new Error(`messages insert: ${insertErr?.message ?? 'no row returned'}`);
  }

  await audit({
    campusId,
    actorUserId: uid,
    action: 'message.broadcast',
    target: inserted.id,
    metadata: { studentUserId: body.studentUserId },
  });

  res.status(201).json({
    id: inserted.id,
    at: new Date(inserted.at).getTime(),
  });
}
