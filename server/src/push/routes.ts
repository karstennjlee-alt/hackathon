// POST /v1/devices — register (upsert) this device's Expo push token.
// DELETE /v1/devices — forget it (sign-out).

import type { Request, Response } from 'express';
import { z } from 'zod';
import { admin } from '../supabase';
import { ApiError, parseBody } from '../http';

const Body = z.object({
  pushToken: z.string().min(10).max(200).regex(/^Expo(nent)?PushToken\[.+\]$/, 'not an Expo push token'),
  platform: z.enum(['ios', 'android']),
});

export async function postRegisterDevice(req: Request, res: Response): Promise<void> {
  const uid = req.user?.sub;
  if (!uid) throw new ApiError(401, 'AUTH_REQUIRED', 'no verified token');
  const body = parseBody(Body, req.body);

  const { error } = await admin.from('devices').upsert(
    { user_id: uid, push_token: body.pushToken, platform: body.platform, last_seen_at: new Date().toISOString() },
    { onConflict: 'user_id,push_token' },
  );
  if (error) throw new Error(`devices upsert: ${error.message}`);
  res.status(204).end();
}

export async function deleteDevice(req: Request, res: Response): Promise<void> {
  const uid = req.user?.sub;
  if (!uid) throw new ApiError(401, 'AUTH_REQUIRED', 'no verified token');
  const body = parseBody(Body.pick({ pushToken: true }), req.body);
  await admin.from('devices').delete().eq('user_id', uid).eq('push_token', body.pushToken);
  res.status(204).end();
}
