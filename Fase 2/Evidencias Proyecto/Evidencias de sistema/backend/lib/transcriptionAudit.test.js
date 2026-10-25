// Pruebas del mapeo y la persistencia idempotente de la auditoría (sin base de datos).
const test = require('node:test');
const assert = require('node:assert/strict');

const { auditRowsFor, persistAudit } = require('./transcriptionAudit');

const diagnostics = [
  { index: 0, status: 'ok', engine: 'nvidia-whisper-large-v3', code: null, totalMs: 1500, attempts: [{ engine: 'nvidia-whisper-large-v3', ok: true, ms: 1500 }] },
  { index: 1, status: 'failed', engine: null, code: 'BUDGET_EXHAUSTED', totalMs: 45000, attempts: [
    { engine: 'nvidia-whisper-large-v3', ok: false, code: 'TIMEOUT', ms: 10000 },
    { engine: 'local-whisper-small', skipped: 'BUDGET_EXHAUSTED' },
  ] },
];

test('mapea una fila por turno con motor, texto y motivo', () => {
  const rows = auditRowsFor({ sessionId: 's1', diagnostics, answers: ['hola mundo', ''] });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].turnIndex, 0);
  assert.equal(rows[0].engine, 'nvidia-whisper-large-v3');
  assert.equal(rows[0].transcript, 'hola mundo');
  assert.equal(rows[0].reason, 'PRIORITY');
  assert.equal(rows[1].status, 'failed');
  assert.equal(rows[1].transcript, null);
  assert.equal(rows[1].reason, 'BUDGET_EXHAUSTED');
});

test('los intentos distinguen éxito, timeout y no necesario', () => {
  const rows = auditRowsFor({ sessionId: 's1', diagnostics, answers: ['hola', ''] });
  assert.deepEqual(rows[1].attempts, [
    { engine: 'nvidia-whisper-large-v3', status: 'timeout', code: 'TIMEOUT', ms: 10000, chars: null },
    { engine: 'local-whisper-small', status: 'not_needed', code: null, ms: null, chars: null },
  ]);
});

test('el texto vacío nunca se marca como éxito', () => {
  const rows = auditRowsFor({
    sessionId: 's1',
    diagnostics: [{ index: 0, status: 'ok', engine: 'x', totalMs: 1, attempts: [] }],
    answers: ['   '],
  });
  assert.equal(rows[0].status, 'failed');
  assert.equal(rows[0].transcript, null);
});

test('dos turnos conservan motores distintos y no se mezclan', () => {
  const rows = auditRowsFor({
    sessionId: 's1',
    diagnostics: [
      { index: 0, status: 'ok', engine: 'nvidia-whisper-large-v3', totalMs: 100, attempts: [] },
      { index: 1, status: 'ok', engine: 'nvidia-canary-1b', totalMs: 200, attempts: [] },
    ],
    answers: ['uno', 'dos'],
  });
  assert.deepEqual(rows.map((r) => [r.turnIndex, r.engine, r.transcript]), [
    [0, 'nvidia-whisper-large-v3', 'uno'],
    [1, 'nvidia-canary-1b', 'dos'],
  ]);
});

test('la persistencia crea una fila por (sesión, turno) y reintentar no duplica', async () => {
  const created = [];
  const prisma = {
    transcriptionAudit: {
      create: async (args) => {
        created.push(args.data);
        return {};
      },
      updateMany: async () => ({ count: 0 }),
    },
  };
  const rows = auditRowsFor({ sessionId: 's1', diagnostics, answers: ['hola', ''] });
  assert.equal(await persistAudit(prisma, rows), 2);
  assert.equal(created.length, 2);
  assert.equal(created[0].turnIndex, 0);
  assert.equal(created[1].status, 'failed');
});

test('un fallo previo se completa cuando el reintento sí transcribe', async () => {
  const updates = [];
  const prisma = {
    transcriptionAudit: {
      create: async () => {
        throw Object.assign(new Error('duplicado'), { code: 'P2002' });
      },
      updateMany: async (args) => {
        updates.push(args);
        return { count: 1 };
      },
    },
  };
  const saved = await persistAudit(prisma, [{ sessionId: 's1', turnIndex: 0, status: 'ok', transcript: 'ok' }]);
  assert.equal(saved, 1);
  assert.deepEqual(updates[0].where, { sessionId: 's1', turnIndex: 0, status: 'failed' });
});

test('una auditoría ya completada no se reescribe', async () => {
  let updateCalls = 0;
  const prisma = {
    transcriptionAudit: {
      create: async () => {
        throw Object.assign(new Error('duplicado'), { code: 'P2002' });
      },
      updateMany: async () => {
        updateCalls += 1;
        return { count: 0 };
      },
    },
  };
  const saved = await persistAudit(prisma, [{ sessionId: 's1', turnIndex: 0, status: 'ok', transcript: 'nuevo' }]);
  assert.equal(saved, 0);
  assert.equal(updateCalls, 1, 'el WHERE exige status=failed, así que un ok real no cambia');
});

test('los intentos no guardan texto transcrito (sólo caracteres)', () => {
  const rows = auditRowsFor({ sessionId: 's1', diagnostics, answers: ['hola', ''] });
  const serialized = JSON.stringify(rows.map((row) => row.attempts));
  assert.doesNotMatch(serialized, /hola/, 'no debe duplicarse el texto en la auditoría de intentos');
});

test('un fallo de la base no tumba la evaluación', async () => {
  const prisma = { transcriptionAudit: { upsert: async () => { throw new Error('db caída'); } } };
  const saved = await persistAudit(prisma, [{ sessionId: 's1', turnIndex: 0 }]);
  assert.equal(saved, 0);
});
