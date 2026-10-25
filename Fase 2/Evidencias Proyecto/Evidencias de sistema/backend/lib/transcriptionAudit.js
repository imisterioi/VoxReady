// Auditoría de transcripción por respuesta.
//
// Mapea el resultado de `transcribeAnswers` a filas de `TranscriptionAudit` y las guarda
// con `upsert` sobre la clave única (sessionId, turnIndex): reintentar la evaluación no
// duplica registros ni pisa una auditoría ya cerrada con datos de una tarea tardía.
//
// No guarda el texto de cada motor, sólo su estado, duración y número de caracteres; el
// texto completo se guarda únicamente para el motor elegido (y se borra con la retención).

function attemptsFor(diagnostic) {
  return (diagnostic?.attempts || []).map((attempt) => ({
    engine: attempt.engine,
    status: attempt.skipped
      ? 'not_needed'
      : attempt.ok
        ? 'success'
        : attempt.code === 'TIMEOUT'
          ? 'timeout'
          : attempt.code === 'CANCELLED'
            ? 'cancelled'
            : 'failed',
    code: attempt.code || null,
    ms: Number.isFinite(attempt.ms) ? Math.round(attempt.ms) : null,
    chars: Number.isFinite(attempt.chars) ? attempt.chars : null,
  }));
}

// Filas listas para persistir. `answers` viene del mismo resultado que usó el evaluador.
function auditRowsFor({ sessionId, diagnostics = [], answers = [] } = {}) {
  return diagnostics.map((diagnostic) => {
    const index = Number(diagnostic?.index);
    const text = String(answers[index] ?? '').trim();
    const ok = diagnostic?.status === 'ok' && Boolean(text);
    return {
      sessionId,
      turnIndex: index,
      status: ok ? 'ok' : 'failed',
      engine: diagnostic?.engine || null,
      transcript: ok ? text : null,
      totalMs: Number.isFinite(diagnostic?.totalMs) ? Math.round(diagnostic.totalMs) : null,
      reason: ok ? 'PRIORITY' : diagnostic?.code || 'ALL_ENGINES_FAILED',
      attempts: attemptsFor(diagnostic),
    };
  });
}

// Persistencia idempotente con transición explícita:
//   - si no existe la fila, se crea;
//   - si ya existe, SÓLO se permite `failed → ok` (un reintento que sí transcribe);
//   - una fila ya `ok` nunca se sobrescribe (ni por un reintento ni por una tarea tardía).
// Nunca lanza: un fallo de auditoría no debe tumbar la evaluación.
async function persistAudit(prisma, rows = []) {
  let saved = 0;
  for (const row of rows) {
    try {
      await prisma.transcriptionAudit.create({ data: row });
      saved += 1;
    } catch (error) {
      if (error?.code !== 'P2002') {
        console.error('[ASR] no se pudo guardar la auditoría:', error?.message);
        continue;
      }
      // Ya existe (misma sesión y turno).
      if (row.status !== 'ok') continue;
      try {
        const updated = await prisma.transcriptionAudit.updateMany({
          where: { sessionId: row.sessionId, turnIndex: row.turnIndex, status: 'failed' },
          data: row,
        });
        saved += updated?.count ?? 0;
      } catch (updateError) {
        console.error('[ASR] no se pudo completar la auditoría:', updateError?.message);
      }
    }
  }
  return saved;
}

// Transcripciones por turno YA registradas como correctas (auditoria `ok` con texto).
// La evaluacion las reutiliza para no repetir ASR sobre las mismas ventanas: el texto vive en la
// auditoria y la retencion ya lo limpia. Nunca lanza: si no se puede leer, se devuelve vacio.
async function reusableTranscripts(prisma, sessionId) {
  const map = new Map();
  if (!sessionId || !prisma?.transcriptionAudit?.findMany) return map;
  try {
    const rows = await prisma.transcriptionAudit.findMany({
      where: { sessionId, status: 'ok' },
      select: { turnIndex: true, transcript: true },
    });
    for (const row of rows) {
      const text = String(row?.transcript ?? '').trim();
      if (text) map.set(Number(row.turnIndex), text);
    }
  } catch (error) {
    console.error('[ASR] no se pudieron leer las transcripciones reutilizables:', error?.message);
  }
  return map;
}

module.exports = { auditRowsFor, persistAudit, attemptsFor, reusableTranscripts };
