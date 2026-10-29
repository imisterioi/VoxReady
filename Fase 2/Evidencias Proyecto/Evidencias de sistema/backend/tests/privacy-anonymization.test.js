// Pruebas de la anonimización de transcripciones de auditoría.
// Datos sintéticos, base simulada y autenticación sustituida: no se toca ninguna base real.
const test = require('node:test');
const assert = require('node:assert/strict');

const { createPrismaStub, TEXTO, anonymizationSeed } = require('./privacy-support');
const { anonymizeUser, anonymizeSession } = require('../lib/anonymize');

const seed = anonymizationSeed;

test('anonimización: limpia las transcripciones de auditoría del usuario y conserva lo operativo', async () => {
  const prisma = createPrismaStub(seed());

  const result = await anonymizeUser(prisma, 'u1');

  assert.equal(result.found, true);
  assert.equal(result.already, false);
  assert.equal(result.auditsCleared, 3, 'una fila por turno de sus dos sesiones');

  const aud1 = prisma.db.transcriptionAudit.find((a) => a.id === 'aud-1');
  assert.equal(aud1.transcript, null, 'el texto transcrito se neutraliza');
  assert.equal(aud1.turnIndex, 0, 'se conserva el turno');
  assert.equal(aud1.status, 'ok', 'se conserva el estado');
  assert.equal(aud1.engine, 'nvidia-whisper-large-v3', 'se conserva el motor');
  assert.equal(aud1.totalMs, 1200, 'se conserva el tiempo');
  assert.equal(aud1.reason, 'PRIORITY', 'se conserva el motivo');
  assert.deepEqual(aud1.attempts, [{ engine: 'nvidia-whisper-large-v3', status: 'ok', ms: 1200, chars: TEXTO.length }], 'se conservan los intentos');

  assert.equal(prisma.db.transcriptionAudit.find((a) => a.id === 'aud-3').transcript, null, 'segunda sesión del usuario');

  // Otros usuarios no se alteran.
  assert.equal(prisma.db.transcriptionAudit.find((a) => a.id === 'aud-4').transcript, TEXTO, 'la auditoría de u2 sigue intacta');
  assert.equal(prisma.db.user.find((u) => u.id === 'u2').name, 'Diego Paredes');
});

test('anonimización: conserva puntuaciones y métricas, y limpia el texto del informe', async () => {
  const prisma = createPrismaStub(seed());

  await anonymizeUser(prisma, 'u1');

  const s1 = prisma.db.session.find((s) => s.id === 'anon-s1');
  assert.equal(prisma.db.session.filter((s) => s.userId === 'u1').length, 2, 'las sesiones se conservan');
  assert.equal(s1.score, 72, 'la puntuación se conserva');
  assert.equal(s1.metrics.voice.wpm, 130, 'las métricas numéricas se conservan');
  assert.equal(s1.metrics.voice.fillerWords, undefined, 'las palabras dichas se eliminan');
  assert.equal(s1.transcript[0].answer, undefined, 'la respuesta del vocero se elimina');
  assert.equal(s1.report.global, 72, 'el puntaje del informe se conserva');
  assert.deepEqual(s1.report.areas, [{ key: 'voice', score: 70 }], 'las áreas y sus puntajes se conservan');
  assert.equal(s1.report.resumen, undefined, 'el resumen redactado se elimina');
  assert.equal(s1.report.porPregunta[0].puntaje, 70, 'el puntaje por pregunta se conserva');
  assert.equal(s1.report.porPregunta[0].comentario, undefined, 'el comentario por pregunta se elimina');

  const user = prisma.db.user.find((u) => u.id === 'u1');
  assert.equal(user.name, 'Usuario anonimizado');
  assert.equal(user.email, 'anon+u1@removed.local');
  assert.equal(user.passwordHash, null);
  assert.equal(user.area, null);
  assert.notEqual(user.anonymizedAt, null);
});

test('anonimización: repetir la operación no provoca errores ni cambios adicionales', async () => {
  const prisma = createPrismaStub(seed());

  await anonymizeUser(prisma, 'u1');
  const antes = JSON.stringify(prisma.db.transcriptionAudit);
  const segunda = await anonymizeUser(prisma, 'u1');

  assert.equal(segunda.found, true);
  assert.equal(segunda.already, true, 'se reconoce como ya anonimizado');
  assert.equal(segunda.auditsCleared, 0);
  assert.equal(JSON.stringify(prisma.db.transcriptionAudit), antes, 'no hay cambios adicionales');
  assert.equal(prisma.db.transcriptionAudit.find((a) => a.id === 'aud-4').transcript, TEXTO);
});

test('anonimización: la limpieza de auditoría se ejecuta con el cliente de la transacción', async () => {
  const prisma = createPrismaStub(seed());

  // Se instrumentan por separado el cliente global y el de la transacción: si el código usara el
  // global dentro de la transacción, la prueba fallaría.
  let porTx = 0;
  let porGlobal = 0;
  const globalOriginal = prisma.transcriptionAudit.updateMany.bind(prisma.transcriptionAudit);
  prisma.transcriptionAudit.updateMany = async (args) => {
    porGlobal += 1;
    return globalOriginal(args);
  };
  const transactionOriginal = prisma.$transaction;
  prisma.$transaction = (fn) =>
    transactionOriginal((tx) => {
      const txOriginal = tx.transcriptionAudit.updateMany.bind(tx.transcriptionAudit);
      tx.transcriptionAudit.updateMany = async (args) => {
        porTx += 1;
        return txOriginal(args);
      };
      return fn(tx);
    });

  const result = await anonymizeUser(prisma, 'u1');

  assert.equal(porTx, 1, 'la limpieza se hace dentro de la transacción');
  assert.equal(porGlobal, 0, 'no se usa el cliente global dentro de la transacción');
  assert.equal(result.auditsCleared, 3);
});

test('anonimización: si falla algo dentro de la transacción no queda ningún cambio a medias', async () => {
  const prisma = createPrismaStub(seed());

  // Se fuerza un fallo al final de la transacción (actualización del usuario).
  const transactionOriginal = prisma.$transaction;
  prisma.$transaction = (fn) =>
    transactionOriginal((tx) => {
      tx.user.update = async () => {
        throw new Error('fallo simulado');
      };
      return fn(tx);
    });

  await assert.rejects(() => anonymizeUser(prisma, 'u1'), /fallo simulado/);

  // Nada se aplicó: ni la sesión, ni la auditoría, ni el usuario.
  assert.equal(prisma.db.user.find((u) => u.id === 'u1').name, 'Ana Torres', 'el usuario no quedó a medias');
  assert.equal(prisma.db.session.find((s) => s.id === 'anon-s1').transcript[0].answer, TEXTO, 'la sesión no se limpió');
  assert.equal(prisma.db.transcriptionAudit.find((a) => a.id === 'aud-1').transcript, TEXTO, 'la auditoría no se limpió');
});

test('anonimización: la limpieza por sesión solo afecta a esa sesión', async () => {
  const prisma = createPrismaStub(seed());

  const result = await anonymizeSession(prisma, 'anon-s2');

  assert.equal(result.found, true);
  assert.equal(result.auditsCleared, 1);
  assert.equal(prisma.db.transcriptionAudit.find((a) => a.id === 'aud-3').transcript, null);
  assert.equal(prisma.db.transcriptionAudit.find((a) => a.id === 'aud-1').transcript, TEXTO, 'la auditoría de otra sesión no se toca');
});
