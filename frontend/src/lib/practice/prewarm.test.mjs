import assert from 'node:assert/strict';
import test from 'node:test';

import { createPrewarmTrigger } from './prewarm.js';

const tick = () => new Promise((r) => setImmediate(r));

test('lanza el precalentamiento una sola vez por sesión', async () => {
  const calls = [];
  const trigger = createPrewarmTrigger({ post: async (id) => { calls.push(id); return { status: 'ok' }; } });
  await trigger.start('s1');
  await trigger.start('s1');
  await trigger.start('s1');
  assert.deepEqual(calls, ['s1']);
});

test('renders repetidos mientras está en vuelo no duplican la solicitud', async () => {
  let release;
  const calls = [];
  const trigger = createPrewarmTrigger({
    post: (id) => {
      calls.push(id);
      return new Promise((resolve) => { release = resolve; });
    },
  });
  const first = trigger.start('s1');
  const second = trigger.start('s1');
  assert.equal((await second).deduped, true);
  release({ status: 'ok' });
  await first;
  assert.equal(calls.length, 1);
});

test('un error de precalentamiento no bloquea: no lanza ni rechaza', async () => {
  const trigger = createPrewarmTrigger({ post: async () => { throw new Error('502'); } });
  const result = await trigger.start('s1');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'ERROR');
});

test('sin sessionId no se llama al backend', async () => {
  let called = false;
  const trigger = createPrewarmTrigger({ post: async () => { called = true; } });
  const result = await trigger.start(null);
  assert.equal(result.reason, 'NO_SESSION');
  assert.equal(called, false);
});

test('una respuesta de una sesión ya reemplazada se ignora', async () => {
  let current = 's1';
  const trigger = createPrewarmTrigger({
    post: async () => ({ status: 'ok', reserved: 2 }),
    isCurrentSession: (id) => id === current,
  });
  const pending = trigger.start('s1');
  current = 's2';
  const result = await pending;
  assert.equal(result.reason, 'STALE');
});

test('una sesión distinta sí puede precalentarse', async () => {
  const calls = [];
  const trigger = createPrewarmTrigger({ post: async (id) => { calls.push(id); return { status: 'ok' }; } });
  await trigger.start('s1');
  await trigger.start('s2');
  assert.deepEqual(calls, ['s1', 's2']);
  assert.equal(trigger.isStarted('s2'), true);
});

test('reset permite volver a precalentar la misma sesión', async () => {
  const calls = [];
  const trigger = createPrewarmTrigger({ post: async (id) => { calls.push(id); return { status: 'ok' }; } });
  await trigger.start('s1');
  trigger.reset();
  await trigger.start('s1');
  assert.deepEqual(calls, ['s1', 's1']);
});

test('el precalentamiento no bloquea: resuelve aunque el backend tarde', async () => {
  let release;
  const trigger = createPrewarmTrigger({ post: () => new Promise((resolve) => { release = resolve; }) });
  const pending = trigger.start('s1');
  await tick();
  assert.equal(trigger.isPending(), true, 'sigue en vuelo sin bloquear al llamador');
  release({ status: 'ok' });
  assert.equal((await pending).ok, true);
  assert.equal(trigger.isPending(), false);
});
