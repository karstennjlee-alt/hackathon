// Student ID sign-in (PRD §8.1 — minors, mostly without email).
//
//   POST /v1/roster/students              admin: provision students, returns PINs
//   POST /v1/roster/students/:id/pin      admin: rotate one student's PIN
//   POST /v1/auth/student-login           PUBLIC: campus code + student ID + PIN
//                                          → one-shot Supabase token hash
//
// The server owns the auth.users row for each student (synthetic email
// that is never mailed) and stores only a scrypt hash of the PIN. Login
// verifies the PIN, then asks Supabase Admin for a magic-link token hash
// which the app exchanges with verifyOtp() for a normal session — so RLS,
// realtime and every /v1 route see an ordinary student JWT.

import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { z } from 'zod';
import crypto from 'node:crypto';
import { admin } from '../supabase';
import { ApiError, parseBody } from '../http';
import { audit } from '../audit';
import { setSessionClaims } from './claims';

// ─── PIN hashing ──────────────────────────────────────────────────
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 };

function hashPin(pin: string): string {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(pin, salt, SCRYPT.keylen, SCRYPT);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

function verifyPin(pin: string, stored: string): boolean {
  const [algo, saltB64, keyB64] = stored.split('$');
  if (algo !== 'scrypt' || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, 'base64');
  const actual = crypto.scryptSync(pin, Buffer.from(saltB64, 'base64'), expected.length, SCRYPT);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function generatePin(): string {
  // 6 digits, no leading-zero ambiguity issues since it's a string.
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
}

// Normalise what a kid types: trim, collapse spaces, case-fold.
function normaliseStudentId(raw: string): string {
  return raw.trim().replace(/\s+/g, '').toUpperCase();
}

function normaliseCampusCode(raw: string): string {
  return raw.trim().replace(/[\s-]+/g, '').toUpperCase();
}

// Synthetic, never-mailed address. Derived from campus + student id so
// re-provisioning the same student is idempotent.
function syntheticEmail(campusId: string, studentId: string): string {
  const h = crypto.createHash('sha256').update(`${campusId}:${studentId}`).digest('hex').slice(0, 24);
  return `stu.${h}@students.beacon5.app`;
}

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

// ─── in-memory IP throttle for the public login route ─────────────
// Belt-and-braces on top of the per-student DB lockout. 20 attempts per
// IP per 10 minutes; a school's shared NAT is fine for legitimate use.
const ipHits = new Map<string, { count: number; resetAt: number }>();
const IP_WINDOW_MS = 10 * 60 * 1000;
const IP_MAX = 20;

export const throttleStudentLogin: RequestHandler = (req: Request, _res: Response, next: NextFunction) => {
  const ip = req.ip ?? 'unknown';
  const now = Date.now();
  const cur = ipHits.get(ip);
  if (!cur || cur.resetAt < now) {
    ipHits.set(ip, { count: 1, resetAt: now + IP_WINDOW_MS });
    return next();
  }
  cur.count += 1;
  if (cur.count > IP_MAX) {
    return next(new ApiError(429, 'RATE_LIMITED', 'too many sign-in attempts, try again later'));
  }
  next();
  if (ipHits.size > 10_000) ipHits.clear(); // crude memory bound
};

// ─── POST /v1/roster/students ─────────────────────────────────────
const ProvisionBody = z.object({
  students: z
    .array(
      z.object({
        studentId: z.string().min(1).max(40),
        displayName: z.string().min(1).max(60),
        pin: z.string().regex(/^\d{4,8}$/, 'PIN must be 4–8 digits').optional(),
      }),
    )
    .min(1)
    .max(200),
});

interface ProvisionResult {
  studentId: string;
  status: 'created' | 'exists' | 'error';
  // Only returned when the server generated it — the school writes it
  // down and hands it to the student. Never stored in plain text.
  pin?: string;
  error?: string;
}

export async function postProvisionStudents(req: Request, res: Response): Promise<void> {
  const campusId = req.user?.app_metadata?.campus_id;
  const actor = req.user?.sub;
  if (!campusId || !actor) throw new ApiError(403, 'NOT_MEMBER', 'caller is not a campus member');
  const body = parseBody(ProvisionBody, req.body);

  const results: ProvisionResult[] = [];
  for (const s of body.students) {
    const studentId = normaliseStudentId(s.studentId);
    try {
      const { data: existing } = await admin
        .from('student_credentials')
        .select('student_id')
        .eq('campus_id', campusId)
        .eq('student_id', studentId)
        .maybeSingle();
      if (existing) {
        results.push({ studentId, status: 'exists' });
        continue;
      }

      const email = syntheticEmail(campusId, studentId);
      // Create (or reuse — a half-finished earlier run) the auth user.
      let uid: string | null = null;
      const created = await admin.auth.admin.createUser({
        email,
        email_confirm: true,
        password: crypto.randomBytes(32).toString('base64url'),
        user_metadata: { student_id: studentId, campus_id: campusId },
      });
      if (created.data.user) uid = created.data.user.id;
      else if (created.error && /already/i.test(created.error.message)) {
        const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
        uid = list?.users.find((u) => u.email === email)?.id ?? null;
      }
      if (!uid) throw new Error(created.error?.message ?? 'createUser returned no user');

      const { error: userErr } = await admin.from('users').upsert(
        {
          id: uid,
          campus_id: campusId,
          role: 'student',
          display_name: s.displayName.trim(),
          is_minor: true,
          auth_provider: 'student-id',
        },
        { onConflict: 'id' },
      );
      if (userErr) throw new Error(`users upsert: ${userErr.message}`);

      const pin = s.pin ?? generatePin();
      const { error: credErr } = await admin.from('student_credentials').insert({
        campus_id: campusId,
        student_id: studentId,
        auth_user_id: uid,
        pin_hash: hashPin(pin),
        created_by: actor,
      });
      if (credErr) throw new Error(`student_credentials insert: ${credErr.message}`);

      await setSessionClaims(uid, { campusId, role: 'student' });
      results.push({ studentId, status: 'created', ...(s.pin ? {} : { pin }) });
    } catch (err) {
      results.push({ studentId, status: 'error', error: err instanceof Error ? err.message : String(err) });
    }
  }

  await audit({
    campusId,
    actorUserId: actor,
    action: 'roster.provision-students',
    metadata: {
      created: results.filter((r) => r.status === 'created').length,
      exists: results.filter((r) => r.status === 'exists').length,
      errors: results.filter((r) => r.status === 'error').length,
    },
  });

  res.status(201).json({ results });
}

// ─── POST /v1/roster/students/:studentId/pin ──────────────────────
const RotateBody = z.object({
  pin: z.string().regex(/^\d{4,8}$/, 'PIN must be 4–8 digits').optional(),
});

export async function postRotateStudentPin(req: Request, res: Response): Promise<void> {
  const campusId = req.user?.app_metadata?.campus_id;
  const actor = req.user?.sub;
  if (!campusId || !actor) throw new ApiError(403, 'NOT_MEMBER', 'caller is not a campus member');
  const studentId = normaliseStudentId(String(req.params.studentId ?? ''));
  if (!studentId) throw new ApiError(400, 'BAD_REQUEST', 'studentId required', 'studentId');
  const body = parseBody(RotateBody, req.body ?? {});

  const pin = body.pin ?? generatePin();
  const { data, error } = await admin
    .from('student_credentials')
    .update({ pin_hash: hashPin(pin), failed_attempts: 0, locked_until: null, pin_rotated_at: new Date().toISOString() })
    .eq('campus_id', campusId)
    .eq('student_id', studentId)
    .select('student_id')
    .maybeSingle();
  if (error) throw new Error(`student_credentials update: ${error.message}`);
  if (!data) throw new ApiError(404, 'NOT_FOUND', 'no such student on this campus');

  await audit({ campusId, actorUserId: actor, action: 'roster.rotate-pin', target: studentId });
  res.json({ studentId, ...(body.pin ? {} : { pin }) });
}

// ─── POST /v1/auth/student-login (public) ─────────────────────────
const LoginBody = z.object({
  campusCode: z.string().min(3).max(16),
  studentId: z.string().min(1).max(40),
  pin: z.string().regex(/^\d{4,8}$/),
});

const GENERIC = new ApiError(401, 'STUDENT_LOGIN_FAILED', "That campus code, student ID and PIN don't match.");

export async function postStudentLogin(req: Request, res: Response): Promise<void> {
  const body = parseBody(LoginBody, req.body);
  const campusCode = normaliseCampusCode(body.campusCode);
  const studentId = normaliseStudentId(body.studentId);

  const { data: campus, error: campusErr } = await admin
    .from('campuses')
    .select('id')
    .eq('code', campusCode)
    .maybeSingle();
  if (campusErr) throw new Error(`campuses lookup: ${campusErr.message}`);
  if (!campus) throw GENERIC;

  const { data: cred, error: credErr } = await admin
    .from('student_credentials')
    .select('auth_user_id, pin_hash, failed_attempts, locked_until')
    .eq('campus_id', campus.id)
    .eq('student_id', studentId)
    .maybeSingle();
  if (credErr) throw new Error(`student_credentials lookup: ${credErr.message}`);
  if (!cred) {
    // Burn the same time as a real check so enumeration isn't trivially timed.
    verifyPin(body.pin, hashPin('000000'));
    throw GENERIC;
  }

  if (cred.locked_until && new Date(cred.locked_until).getTime() > Date.now()) {
    throw new ApiError(423, 'STUDENT_LOCKED', `Too many wrong PINs. Try again in ${LOCK_MINUTES} minutes or ask a teacher to reset it.`);
  }

  if (!verifyPin(body.pin, cred.pin_hash)) {
    const failed = (cred.failed_attempts ?? 0) + 1;
    const lock = failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString() : null;
    await admin
      .from('student_credentials')
      .update({ failed_attempts: lock ? 0 : failed, locked_until: lock })
      .eq('campus_id', campus.id)
      .eq('student_id', studentId);
    if (lock) {
      await audit({ campusId: campus.id, actorUserId: cred.auth_user_id, action: 'student.login-locked', target: studentId });
      throw new ApiError(423, 'STUDENT_LOCKED', `Too many wrong PINs. Try again in ${LOCK_MINUTES} minutes or ask a teacher to reset it.`);
    }
    throw GENERIC;
  }

  if (cred.failed_attempts) {
    await admin
      .from('student_credentials')
      .update({ failed_attempts: 0, locked_until: null })
      .eq('campus_id', campus.id)
      .eq('student_id', studentId);
  }

  // Make sure the JWT will carry the right claims, then mint the one-shot token.
  await setSessionClaims(cred.auth_user_id, { campusId: campus.id, role: 'student' });
  const { data: u } = await admin.auth.admin.getUserById(cred.auth_user_id);
  const email = u.user?.email;
  if (!email) throw new Error('student auth user has no email');
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  if (linkErr || !link?.properties?.hashed_token) {
    throw new Error(`generateLink: ${linkErr?.message ?? 'no hashed_token'}`);
  }

  await audit({ campusId: campus.id, actorUserId: cred.auth_user_id, action: 'student.login', target: studentId });
  res.json({ tokenHash: link.properties.hashed_token });
}
