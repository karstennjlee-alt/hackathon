// /v1/threat — campus-wide threat declare/clear.
//
// Routes:
//   POST /v1/threat/declare — open a campus-wide threat banner
//   POST /v1/threat/clear   — close the active threat
//
// Authorization is layered:
//   1. verifyToken + requireCampusMember (in index.ts)
//   2. requirePermission('threat:declare'|'threat:clear') (step-up enforced
//      by requirePermission because both perms are in STEP_UP_PERMISSIONS)
//   3. campus.policy.whoCanDeclareThreat — if 'admin-only', only role===admin
//      can DECLARE. (Clear is always staff+admin via the permission gate.)

import type { Request, Response } from 'express';
import { admin } from '../supabase';
import { ApiError } from '../http';
import { audit } from '../audit';
import { campusUserIds, pushLater, sendToUsers } from '../push/expo';

interface CampusPolicy {
  whoCanDeclareThreat?: 'any-staff' | 'admin-only';
}

function requireCampus(req: Request): { campusId: string; uid: string; role: string } {
  const campusId = req.user?.app_metadata?.campus_id;
  const role = req.user?.app_metadata?.role;
  const uid = req.user?.sub;
  if (!campusId || !role || !uid) {
    throw new ApiError(403, 'NOT_MEMBER', 'caller is not a campus member');
  }
  return { campusId, uid, role };
}

// ─── POST /v1/threat/declare ──────────────────────────────────────
export async function postDeclareThreat(req: Request, res: Response): Promise<void> {
  const { campusId, uid, role } = requireCampus(req);

  // Honour campus.policy.whoCanDeclareThreat.
  const { data: campus, error: campusErr } = await admin
    .from('campuses')
    .select('policy')
    .eq('id', campusId)
    .maybeSingle();
  if (campusErr) throw new Error(`campuses lookup: ${campusErr.message}`);
  if (!campus) throw new ApiError(404, 'NOT_FOUND', 'campus not found');
  const policy = (campus.policy ?? {}) as CampusPolicy;
  if (policy.whoCanDeclareThreat === 'admin-only' && role !== 'admin') {
    throw new ApiError(403, 'FORBIDDEN', 'campus policy restricts threat declaration to admin');
  }

  // Refuse if there is already an active threat — must clear first.
  const { data: recent, error: recentErr } = await admin
    .from('campus_threats')
    .select('id, status, at')
    .eq('campus_id', campusId)
    .order('at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (recentErr) throw new Error(`campus_threats lookup: ${recentErr.message}`);
  if (recent && recent.status === 'active') {
    res.json({ id: recent.id, status: 'active', alreadyActive: true });
    return;
  }

  const { data: inserted, error: insertErr } = await admin
    .from('campus_threats')
    .insert({ campus_id: campusId, status: 'active', actor_user_id: uid })
    .select('id, at')
    .single();
  if (insertErr || !inserted) {
    throw new Error(`campus_threats insert: ${insertErr?.message ?? 'no row returned'}`);
  }

  await audit({
    campusId,
    actorUserId: uid,
    action: 'threat.declare',
    target: inserted.id,
  });

  res.status(201).json({
    id: inserted.id,
    status: 'active',
    at: new Date(inserted.at).getTime(),
  });

  pushLater(async () => {
    await sendToUsers(await campusUserIds(campusId, ['student', 'staff', 'admin'], uid), {
      kind: 'threat',
      title: 'Campus threat declared',
      body: 'Follow your lockdown plan. Open Beacon5 for instructions.',
      data: { threatId: inserted.id },
    });
    await sendToUsers(await campusUserIds(campusId, ['parent']), {
      kind: 'threat',
      title: 'Beacon5 — official update',
      body: 'A campus threat has been declared. Do not travel to the school. Updates will follow here.',
      data: { threatId: inserted.id },
    });
  });
}

// ─── POST /v1/threat/clear ────────────────────────────────────────
export async function postClearThreat(req: Request, res: Response): Promise<void> {
  const { campusId, uid } = requireCampus(req);

  // Append-only log: the campus is armed iff the LATEST row is 'active'.
  // (Filtering on status='active' would match the original declare row
  // forever and let clear succeed repeatedly.)
  const { data: latest, error: latestErr } = await admin
    .from('campus_threats')
    .select('id, status, at')
    .eq('campus_id', campusId)
    .order('at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestErr) throw new Error(`campus_threats lookup: ${latestErr.message}`);
  if (!latest || latest.status !== 'active') {
    throw new ApiError(409, 'NO_ACTIVE_THREAT', 'no active campus threat to clear');
  }
  const active = latest;

  // Threats are append-only: insert a 'cleared' row referencing the same campus.
  const { data: inserted, error: insertErr } = await admin
    .from('campus_threats')
    .insert({ campus_id: campusId, status: 'cleared', actor_user_id: uid })
    .select('id, at')
    .single();
  if (insertErr || !inserted) {
    throw new Error(`campus_threats insert: ${insertErr?.message ?? 'no row returned'}`);
  }

  await audit({
    campusId,
    actorUserId: uid,
    action: 'threat.clear',
    target: inserted.id,
    metadata: { clearedThreatId: active.id },
  });

  res.json({
    id: inserted.id,
    status: 'cleared',
    at: new Date(inserted.at).getTime(),
  });

  pushLater(async () => {
    await sendToUsers(await campusUserIds(campusId, ['student', 'parent', 'staff', 'admin'], uid), {
      kind: 'threat',
      title: 'All clear',
      body: 'The campus threat has been cleared. Normal operations resume.',
      data: { threatId: inserted.id },
    });
  });
}
