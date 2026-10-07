// Anonimización de voceros y sus sesiones (Bloque A).
// Conserva el histórico estadístico y elimina los datos identificables.
//
// Estrategia de atomicidad: PostgreSQL y el filesystem no comparten transacción.
// Por eso primero se anonimiza todo en BD dentro de una transacción (sesiones +
// usuario + solicitudes) y, una vez confirmada, se eliminan los .webm (best-effort
// con log). Si fallara el borrado de archivos, la BD ya quedó sin PII.
const fs = require('fs');
const path = require('path');

const SESSIONS_DIR = path.join(__dirname, '..', 'uploads', 'sessions');
const videoPathForSession = (id) => path.join(SESSIONS_DIR, `${id}.webm`);

const ANON_NAME = 'Usuario anonimizado';
const anonEmailFor = (userId) => `anon+${userId}@removed.local`;

// ---------------------------------------------------------- limpieza (pura)

// Cada turno: fuera la respuesta (texto del vocero) y las muletillas.
function scrubTurnMetrics(metrics) {
  if (!metrics || typeof metrics !== 'object') return metrics ?? null;
  const out = { ...metrics };
  delete out.fillerWords;
  return out;
}

function scrubTranscript(transcript) {
  if (!Array.isArray(transcript)) return transcript ?? null;
  return transcript.map((turn) => {
    if (!turn || typeof turn !== 'object') return turn;
    const { answer, metrics, ...rest } = turn;
    return { ...rest, metrics: scrubTurnMetrics(metrics) };
  });
}

function scrubMetrics(metrics) {
  if (!metrics || typeof metrics !== 'object') return metrics ?? null;
  const out = { ...metrics };
  if (out.voice && typeof out.voice === 'object') out.voice = scrubTurnMetrics(out.voice);
  return out;
}

function scrubReport(report) {
  if (!report || typeof report !== 'object') return report ?? null;
  const out = { ...report };
  // Texto derivado de las respuestas del vocero: se elimina por completo
  delete out.cita;
  delete out.resumen;
  delete out.mensajesClave;
  delete out.fortalezas;
  delete out.mejoras;
  if (Array.isArray(out.porPregunta)) {
    out.porPregunta = out.porPregunta.map((p) => {
      if (!p || typeof p !== 'object') return p;
      const { comentario, ...rest } = p;
      return rest;
    });
  }
  if (Array.isArray(out.lineasRojas)) {
    out.lineasRojas = out.lineasRojas.map((l) => {
      if (!l || typeof l !== 'object') return l;
      const { evidencia, ...rest } = l;
      return rest;
    });
  }
  if (out.measured && typeof out.measured === 'object') {
    out.measured = { ...out.measured };
    if (out.measured.voice && typeof out.measured.voice === 'object') out.measured.voice = scrubTurnMetrics(out.measured.voice);
  }
  return out;
}

function scrubReview(review) {
  if (!review || typeof review !== 'object') return review ?? null;
  const out = { ...review };
  delete out.comment;
  if (out.reviewer && typeof out.reviewer === 'object') {
    const { name, ...rest } = out.reviewer; // se conserva reviewer.id (trazabilidad)
    out.reviewer = rest;
  }
  return out;
}

// Campos JSON de una sesión ya anonimizados
function sessionScrubData(session) {
  return {
    transcript: scrubTranscript(session.transcript),
    metrics: scrubMetrics(session.metrics),
    report: scrubReport(session.report),
    review: scrubReview(session.review),
  };
}

// ------------------------------------------------------------ archivos .webm

// Elimina los .webm de las sesiones indicadas. Devuelve cuántos archivos borró.
function removeVideoFiles(sessionIds) {
  let removed = 0;
  for (const id of sessionIds) {
    try {
      const file = videoPathForSession(id);
      if (fs.existsSync(file)) {
        fs.rmSync(file, { force: true });
        removed += 1;
      }
    } catch (error) {
      console.warn(`[Anonimización] No se pudo borrar ${id}.webm:`, error.message);
    }
  }
  return removed;
}

// Elimina las grabaciones de los voceros indicados dentro de un tenant.
async function deleteUserVideos(prisma, tenantId, userIds) {
  if (!Array.isArray(userIds) || userIds.length === 0) return 0;
  const sessions = await prisma.session.findMany({
    where: { tenantId, userId: { in: userIds } },
    select: { id: true },
  });
  return removeVideoFiles(sessions.map((s) => s.id));
}

// --------------------------------------------------------------- operaciones

// Anonimiza una sola sesión (conserva id/userId/themeId/tenantId/score/completedAt).
async function anonymizeSession(prisma, sessionId) {
  const session = await prisma.session.findUnique({ where: { id: sessionId } });
  if (!session) return { found: false };
  await prisma.session.update({ where: { id: session.id }, data: sessionScrubData(session) });
  const videoRemoved = removeVideoFiles([session.id]) > 0;
  return { found: true, sessionId: session.id, videoRemoved };
}

// Anonimiza un vocero completo: sus sesiones, el usuario y la PII de solicitudes.
async function anonymizeUser(prisma, userId) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return { found: false };
  if (user.anonymizedAt) return { found: true, already: true, userId: user.id, sessions: 0, videosRemoved: 0 };

  const sessions = await prisma.session.findMany({
    where: { userId: user.id },
    select: { id: true, transcript: true, metrics: true, report: true, review: true },
  });

  // 1) BD: transacción (sesiones → usuario → solicitudes)
  await prisma.$transaction(async (tx) => {
    for (const s of sessions) {
      await tx.session.update({ where: { id: s.id }, data: sessionScrubData(s) });
    }
    await tx.user.update({
      where: { id: user.id },
      data: {
        name: ANON_NAME,
        email: anonEmailFor(user.id),
        area: null,
        passwordHash: null,
        lastLoginAt: null,
        anonymizedAt: new Date(),
      },
    });
    // Limpia el texto libre de las solicitudes que referencian a este usuario
    await tx.deletionRequest.updateMany({
      where: { OR: [{ targetUserId: user.id }, { requestedById: user.id }, { resolvedById: user.id }] },
      data: { reason: null, resolutionNote: null },
    });
  });

  // 2) Filesystem (fuera de la transacción)
  const videosRemoved = removeVideoFiles(sessions.map((s) => s.id));

  return { found: true, already: false, userId: user.id, sessions: sessions.length, videosRemoved };
}

module.exports = {
  anonymizeUser,
  anonymizeSession,
  deleteUserVideos,
  removeVideoFiles,
  videoPathForSession,
  anonEmailFor,
};