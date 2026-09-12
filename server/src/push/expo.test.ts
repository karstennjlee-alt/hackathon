// node --import tsx --test src/**/*.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';

import './test-env';

import { audienceRoles, envelope } from './expo';

test('audienceRoles maps v1 audiences to roles', () => {
  assert.deepEqual(audienceRoles(['students']), ['student']);
  assert.deepEqual(audienceRoles(['parents']), ['parent']);
  assert.deepEqual(audienceRoles(['teachers']).sort(), ['admin', 'staff']);
  assert.deepEqual(audienceRoles(['students', 'parents']).sort(), ['parent', 'student']);
  assert.deepEqual(audienceRoles(['everyone']).sort(), ['admin', 'parent', 'staff', 'student']);
  assert.deepEqual(audienceRoles(['students', 'everyone']).sort(), ['admin', 'parent', 'staff', 'student']);
});

test('threat/beacon pushes are time-sensitive on the emergency channel; others are not', () => {
  const t = envelope({ kind: 'threat', title: 'T', body: 'b' });
  assert.equal(t.interruptionLevel, 'time-sensitive');
  assert.equal(t.channelId, 'emergency');
  assert.equal(t.priority, 'high');
  assert.equal(t.data.remote, true);
  assert.equal(t.data.kind, 'threat');
  const c = envelope({ kind: 'chat', title: 'T', body: 'b', data: { messageId: 'm1' } });
  assert.equal(c.interruptionLevel, 'active');
  assert.equal(c.channelId, 'updates');
  assert.equal(c.data.messageId, 'm1');
  assert.equal(c.data.remote, true);
});
