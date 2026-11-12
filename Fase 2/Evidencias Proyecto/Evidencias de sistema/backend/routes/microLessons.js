// Microlecciones: formación de voceros administrada por el equipo de VoxReady.
//
// - Catálogo (cualquier usuario con sesión): solo lecciones activas del idioma efectivo del usuario.
//   Una lección en español no aparece en el catálogo inglés y viceversa.
// - Recomendación: se marca `recommended` en las lecciones que refuerzan el área más débil del
//   vocero, con la misma regla del informe: de las áreas medidas, la de puntuación más baja de su
//   última práctica evaluada. Sin datos no se recomienda nada.
// - Administración (administrador del sistema): crear, editar, activar/desactivar, subir o
//   reemplazar el video y eliminar (con borrado del archivo asociado).
// - El video se guarda en `uploads/lessons` y se entrega solo por la ruta protegida
//   `GET /api/micro-lessons/:id/video` (sesión válida + estado + idioma). No hay ruta pública.
const fs = require('fs');
const path = require('path');
const { requireAuth } = require('../auth');
const { DEFAULT: DEFAULT_LANGUAGE, normalizeLanguage, resolveLanguage } = require('../lib/language');
const { saveStreamToFile } = require('../lib/uploadGuard');

const LESSONS_DIR = path.join(__dirname, '..', 'uploads', 'lessons');

// Áreas de la RÚBRICA que una microlección puede reforzar (no se crean áreas nuevas).
const AREAS = ['expression', 'voice', 'coherence', 'empathy'];

// Tipos de video admitidos (el contenedor decide la extensión del archivo).
const MEDIA_TYPES = { 'video/webm': 'webm', 'video/mp4': 'mp4' };
const MAX_VIDEO_BYTES = (Number(process.env.LESSON_MAX_VIDEO_MB) || 200) * 1024 * 1024;
const MAX_TITLE = 120;
const MAX_DESCRIPTION = 600;

const UPLOAD_ERRORS = {
  TOO_LARGE: [413, 'El video supera el tamaño máximo permitido.'],
  INVALID_CONTENT: [415, 'El archivo no parece un video válido.'],
  ABORTED: [400, 'La carga del video se interrumpió.'],
  WRITE_ERROR: [500, 'No se pudo guardar el video.'],
};

const fail = (res, code, mensaje) => res.status(code).json({ status: 'error', mensaje });

const ensureDir = () => {
  fs.mkdirSync(LESSONS_DIR, { recursive: true });
};

const videoPathOf = (lesson) => (lesson?.videoFile ? path.join(LESSONS_DIR, lesson.videoFile) : null);

const unlinkQuiet = (file) => {
  try {
    if (file) fs.rmSync(file, { force: true });
  } catch {
    /* best-effort */
  }
};

const normalizeAreas = (value) => {
  const list = Array.isArray(value) ? value : [];
  return [...new Set(list.map((area) => String(area).trim()).filter((area) => AREAS.includes(area)))];
};

const areasOf = (lesson) => (Array.isArray(lesson.areas) ? lesson.areas : []);

const toApiLesson = (lesson, { recommended = false } = {}) => ({
  id: lesson.id,
  title: lesson.title,
  description: lesson.description,
  language: lesson.language,
  areas: areasOf(lesson),
  active: lesson.active,
  hasVideo: Boolean(lesson.videoFile),
  videoMime: lesson.videoMime || null,
  videoBytes: lesson.videoBytes ?? null,
  recommended,
  createdAt: lesson.createdAt,
  updatedAt: lesson.updatedAt,
});

// Área más débil del vocero: misma regla que el informe (la puntuación más baja de las áreas
// medidas en su última práctica evaluada). Si no hay datos, devuelve null.
async function weakestArea(prisma, userId) {
  const session = await prisma.session.findFirst({
    where: { userId, score: { not: null } },
    orderBy: { completedAt: 'desc' },
    select: { report: true },
  });
  const areas = Array.isArray(session?.report?.areas) ? session.report.areas : [];
  const measured = areas.filter((area) => area && area.score != null && AREAS.includes(area.key));
  if (!measured.length) return null;
  return measured.reduce((a, b) => (b.score < a.score ? b : a)).key || null;
}

// Valida el cuerpo de creación/edición. `partial` permite enviar solo algunos campos.
function validatePayload(body, { partial = false } = {}) {
  const data = {};

  if (body.title !== undefined || !partial) {
    const title = String(body.title ?? '').trim();
    if (!title) return { error: 'El título es obligatorio.' };
    if (title.length > MAX_TITLE) return { error: `El título no puede superar ${MAX_TITLE} caracteres.` };
    data.title = title;
  }

  if (body.description !== undefined || !partial) {
    const description = String(body.description ?? '').trim();
    if (!description) return { error: 'La descripción es obligatoria.' };
    if (description.length > MAX_DESCRIPTION) return { error: `La descripción no puede superar ${MAX_DESCRIPTION} caracteres.` };
    data.description = description;
  }

  if (body.language !== undefined || !partial) {
    // El idioma debe estar HABILITADO en la plataforma: no se admiten idiomas sin soporte.
    const language = normalizeLanguage(body.language ?? DEFAULT_LANGUAGE);
    if (!language) return { error: 'El idioma indicado no está admitido.' };
    data.language = language;
  }

  if (body.areas !== undefined || !partial) {
    const areas = normalizeAreas(body.areas);
    if (!areas.length) return { error: 'Selecciona al menos un área que refuerce la microlección.' };
    data.areas = areas;
  }

  if (body.active !== undefined) data.active = Boolean(body.active);

  return { data };
}

module.exports = function registerMicroLessonRoutes(app, prisma) {
  const auth = (...roles) => requireAuth(prisma, roles);
  // ------------------------------------------------------------------ Catálogo
  app.get('/api/micro-lessons', auth(), async (req, res) => {
    try {
      const isSystem = req.apiRole === 'system';
      // `all=1` (solo administrador del sistema): incluye inactivas y todos los idiomas.
      const wantsAll = isSystem && ['1', 'true'].includes(String(req.query.all || '').toLowerCase());
      const language = normalizeLanguage(req.query.language) || resolveLanguage(req.user, req.user.tenant);

      const where = {};
      if (!wantsAll) {
        where.active = true;
        where.language = language;
      } else if (req.query.language) {
        where.language = language;
      }

      const lessons = await prisma.microLesson.findMany({ where, orderBy: [{ createdAt: 'desc' }] });

      // La recomendación se calcula solo para el vocero: son SUS resultados.
      const weak = req.apiRole === 'user' ? await weakestArea(prisma, req.user.id) : null;
      const items = lessons.map((lesson) =>
        toApiLesson(lesson, { recommended: Boolean(weak && areasOf(lesson).includes(weak)) }),
      );

      res.json({ status: 'ok', language, weakestArea: weak, lessons: items });
    } catch (error) {
      console.error('Error listando microlecciones:', error);
      fail(res, 500, 'No se pudieron obtener las microlecciones.');
    }
  });

  // ------------------------------------------------------- Video (ruta protegida)
  app.get('/api/micro-lessons/:id/video', auth(), async (req, res) => {
    try {
      const lesson = await prisma.microLesson.findUnique({ where: { id: req.params.id } });
      if (!lesson) return fail(res, 404, 'Microlección no encontrada.');
      if (!lesson.videoFile) return fail(res, 404, 'La microlección todavía no tiene video.');

      // Autorización: el administrador del sistema ve cualquiera; el resto, solo las ACTIVAS de SU
      // idioma. No basta con ocultar el enlace en la interfaz.
      if (req.apiRole !== 'system') {
        if (!lesson.active) return fail(res, 403, 'La microlección no está disponible.');
        const language = resolveLanguage(req.user, req.user.tenant);
        if (normalizeLanguage(lesson.language) !== language) {
          return fail(res, 403, 'La microlección pertenece a otro idioma.');
        }
      }

      const file = videoPathOf(lesson);
      if (!file || !fs.existsSync(file)) return fail(res, 404, 'El video no está disponible.');
      res.sendFile(file);
    } catch (error) {
      console.error('Error enviando el video de la microlección:', error);
      fail(res, 500, 'No se pudo obtener el video.');
    }
  });

  // ------------------------------------------------- Administración (SYSTEM)
  app.post('/api/micro-lessons', auth('system'), async (req, res) => {
    try {
      const { data, error } = validatePayload(req.body || {});
      if (error) return fail(res, 422, error);
      const lesson = await prisma.microLesson.create({
        data: { ...data, active: data.active ?? true, createdById: req.user.id },
      });
      res.status(201).json({ status: 'ok', lesson: toApiLesson(lesson) });
    } catch (error) {
      console.error('Error creando microlección:', error);
      fail(res, 500, 'No se pudo crear la microlección.');
    }
  });

  app.put('/api/micro-lessons/:id', auth('system'), async (req, res) => {
    try {
      const current = await prisma.microLesson.findUnique({ where: { id: req.params.id } });
      if (!current) return fail(res, 404, 'Microlección no encontrada.');
      const { data, error } = validatePayload(req.body || {}, { partial: true });
      if (error) return fail(res, 422, error);
      const lesson = await prisma.microLesson.update({ where: { id: current.id }, data });
      res.json({ status: 'ok', lesson: toApiLesson(lesson) });
    } catch (error) {
      console.error('Error actualizando microlección:', error);
      fail(res, 500, 'No se pudo actualizar la microlección.');
    }
  });

  // Eliminar: se borra el registro Y su archivo (no se dejan videos huérfanos).
  app.delete('/api/micro-lessons/:id', auth('system'), async (req, res) => {
    try {
      const lesson = await prisma.microLesson.findUnique({ where: { id: req.params.id } });
      if (!lesson) return fail(res, 404, 'Microlección no encontrada.');
      await prisma.microLesson.delete({ where: { id: lesson.id } });
      unlinkQuiet(videoPathOf(lesson));
      res.json({ status: 'ok' });
    } catch (error) {
      console.error('Error eliminando microlección:', error);
      fail(res, 500, 'No se pudo eliminar la microlección.');
    }
  });

  // Subir o REEMPLAZAR el video. El cuerpo es el archivo en binario (igual que las grabaciones de
  // una sesión): se valida el tipo por cabecera, el tamaño y se escribe de forma atómica.
  app.post('/api/micro-lessons/:id/video', auth('system'), async (req, res) => {
    try {
      const lesson = await prisma.microLesson.findUnique({ where: { id: req.params.id } });
      if (!lesson) return fail(res, 404, 'Microlección no encontrada.');

      const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      const extension = MEDIA_TYPES[type];
      if (!extension) return fail(res, 415, 'Formato de video no admitido. Usa WebM o MP4.');

      ensureDir();
      const fileName = `${lesson.id}.${extension}`;
      const destination = path.join(LESSONS_DIR, fileName);
      const previous = videoPathOf(lesson);

      try {
        // WebM se valida por su firma EBML; MP4 no tiene firma EBML (se acepta por tipo declarado).
        const { bytes } = await saveStreamToFile(req, destination, {
          maxBytes: MAX_VIDEO_BYTES,
          validateMagic: extension === 'webm',
        });
        const updated = await prisma.microLesson.update({
          where: { id: lesson.id },
          data: { videoFile: fileName, videoMime: type, videoBytes: bytes },
        });
        // Reemplazo: si el archivo anterior era otro (otra extensión), se elimina.
        if (previous && previous !== destination) unlinkQuiet(previous);
        res.json({ status: 'ok', lesson: toApiLesson(updated) });
      } catch (uploadError) {
        const [status, mensaje] = UPLOAD_ERRORS[uploadError.code] || [500, 'No se pudo guardar el video.'];
        if (status === 500) console.error('Error guardando el video de la microlección:', uploadError.message);
        fail(res, status, mensaje);
      }
    } catch (error) {
      console.error('Error subiendo el video de la microlección:', error);
      fail(res, 500, 'No se pudo subir el video.');
    }
  });
};
