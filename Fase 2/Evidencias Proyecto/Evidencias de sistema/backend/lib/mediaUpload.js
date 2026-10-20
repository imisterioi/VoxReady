// Manejador común de subida de grabaciones (video y audio) de UNA sesión.
//
//   POST /api/sessions/:id/video   -> <id>.webm        (grabación de video, como siempre)
//   POST /api/sessions/:id/audio   -> <id>.audio.webm  (pista de audio para verificar el WPM)
//
// Reglas: dueño de la sesión, sesión sin informe (inmutabilidad), organización no en
// borrado, tipo de contenido permitido y tope de tamaño. Se apoya en `saveStreamToFile`,
// que escribe en `.part`, valida la cabecera WebM y limpia si algo falla.
const path = require('path');

const { saveStreamToFile } = require('./uploadGuard');

const MEDIA_TYPES = new Set(['video/webm', 'audio/webm', 'application/octet-stream']);

const UPLOAD_ERRORS = {
  TOO_LARGE: [413, 'El archivo supera el tamaño máximo permitido.'],
  INVALID_CONTENT: [415, 'El archivo no parece un WebM válido.'],
  ABORTED: [400, 'La subida se interrumpió antes de terminar.'],
  WRITE_ERROR: [500, 'No se pudo guardar el archivo.'],
};

function createMediaUploadHandler({ prisma, sessionsDir, maxVideoBytes, maxAudioBytes }) {
  return async function handleMediaUpload(req, res, { kind = 'video' } = {}) {
    const sessionId = req.params.id;
    const isAudio = kind === 'audio';
    const fileName = isAudio ? `${sessionId}.audio.webm` : `${sessionId}.webm`;
    const filePath = path.join(sessionsDir, fileName);
    const maxBytes = isAudio ? maxAudioBytes : maxVideoBytes;

    try {
      const session = await prisma.session.findUnique({
        where: { id: sessionId },
        include: { tenant: { select: { status: true } } },
      });
      if (!session) return res.status(404).json({ status: 'error', mensaje: 'Sesión no encontrada' });
      if (session.userId !== req.user.id) {
        return res.status(403).json({ status: 'error', mensaje: 'No puedes subir la grabación de otra sesión' });
      }
      // Inmutabilidad: con informe válido no se sustituye ni el video ni el audio que lo sostienen.
      if (session.report) {
        return res.status(409).json({ status: 'error', mensaje: 'La sesión ya tiene un informe: su grabación no se puede sustituir.' });
      }
      if (session.tenant?.status === 'DELETING') {
        return res.status(409).json({ status: 'error', mensaje: 'La organización de esta sesión está en proceso de eliminación.' });
      }

      const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      if (!MEDIA_TYPES.has(type)) {
        return res.status(415).json({ status: 'error', mensaje: 'Formato de archivo no admitido.' });
      }

      const { bytes } = await saveStreamToFile(req, filePath, { maxBytes });
      return res.json({
        status: 'ok',
        mensaje: isAudio ? 'Audio guardado correctamente' : 'Video guardado correctamente',
        file: fileName,
        bytes,
      });
    } catch (error) {
      const [status, mensaje] =
        UPLOAD_ERRORS[error.code] || [500, `No se pudo guardar ${isAudio ? 'el audio' : 'el video'}.`];
      if (status === 500) console.error(`Error guardando ${kind}:`, error.message);
      return res.status(status).json({ status: 'error', mensaje });
    }
  };
}

module.exports = { MEDIA_TYPES, UPLOAD_ERRORS, createMediaUploadHandler };
