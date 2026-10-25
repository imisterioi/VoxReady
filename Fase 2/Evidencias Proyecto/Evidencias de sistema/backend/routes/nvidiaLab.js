// Laboratorio NVIDIA Build (EXPERIMENTAL).
//   GET  /api/lab/nvidia/catalog        -> catálogo verificado y disponibilidad
//   POST /api/lab/nvidia/asr?model=key  -> transcribe con un ASR alojado (gRPC de Riva)
//   GET  /api/lab/nvidia/voice          -> estado de los entrevistadores de voz
//
// La API key vive sólo en el backend. El audio se escribe en un archivo temporal, se envía
// al modelo alojado y se borra: no se persiste ni entra en la base de datos.
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { requireAuth } = require('../auth');
const { ASR_MODELS, VOICE_MODELS, isCallable } = require('../lib/nvidiaCatalog');
const { runAsr } = require('../lib/nvidiaAsr');

const LAB_ROLES = ['master', 'system'];
const MAX_MB = Number(process.env.NVIDIA_ASR_MAX_MB) || 25;
const ALLOWED_TYPES = {
  'audio/webm': 'webm',
  'video/webm': 'webm',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/ogg': 'ogg',
  'audio/opus': 'opus',
  'audio/flac': 'flac',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
};

function readBody(req, limitBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limitBytes) {
        reject(Object.assign(new Error('too large'), { code: 'TOO_LARGE' }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

module.exports = function registerNvidiaLabRoutes(app, prisma) {
  const auth = (...roles) => requireAuth(prisma, roles);

  app.get('/api/lab/nvidia/catalog', auth(...LAB_ROLES), (req, res) => {
    res.json({
      ok: true,
      keyConfigured: Boolean(process.env.NVIDIA_API_KEY),
      asr: ASR_MODELS.map((model) => ({
        key: model.key,
        label: model.label,
        model: model.model,
        protocol: model.protocol,
        language: model.language,
        availability: model.availability,
        callable: isCallable(model),
        spanish: model.spanish,
        audio: model.audio,
        punctuation: model.punctuation,
        timestamps: model.timestamps,
        source: model.source,
      })),
      voice: VOICE_MODELS.map((model) => ({
        key: model.key,
        label: model.label,
        model: model.model,
        protocol: model.protocol,
        availability: model.availability,
        spanish: model.spanish,
        source: model.source,
        // No hay endpoint público: no se simula una sesión de audio.
        reason:
          model.availability === 'early_access'
            ? 'La ficha oficial sólo ofrece «Apply for Early Access» y una demo: no publica endpoint, function-id ni protocolo.'
            : 'Sin endpoint publicado.',
      })),
    });
  });

  app.get('/api/lab/nvidia/voice', auth(...LAB_ROLES), (req, res) => {
    res.json({
      ok: true,
      models: VOICE_MODELS.map((model) => ({
        key: model.key,
        label: model.label,
        availability: model.availability,
        reason: 'Requiere acceso temprano; no hay endpoint ni protocolo publicados para llamarlo.',
      })),
    });
  });

  app.post('/api/lab/nvidia/asr', auth(...LAB_ROLES), async (req, res) => {
    const key = String(req.query?.model || '').trim();
    const model = ASR_MODELS.find((item) => item.key === key);
    if (!model) return res.status(400).json({ ok: false, code: 'UNKNOWN_MODEL', message: 'Modelo no reconocido.' });
    if (!isCallable(model)) {
      return res.status(503).json({
        ok: false,
        code: 'NOT_AVAILABLE',
        message: 'Este modelo no tiene endpoint alojado publicado para esta cuenta.',
      });
    }

    const contentType = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    const extension = ALLOWED_TYPES[contentType];
    if (!extension) return res.status(415).json({ ok: false, code: 'BAD_TYPE', message: 'Formato de audio no admitido.' });

    const started = Date.now();
    let audio;
    try {
      audio = await readBody(req, Math.round(MAX_MB * 1024 * 1024));
    } catch (error) {
      if (error.code === 'TOO_LARGE') {
        return res.status(413).json({ ok: false, code: 'TOO_LARGE', message: `El audio supera ${MAX_MB} MB.` });
      }
      return res.status(400).json({ ok: false, code: 'BAD_BODY', message: 'No se pudo leer el audio enviado.' });
    }
    if (!audio.length) return res.status(400).json({ ok: false, code: 'EMPTY', message: 'El audio llegó vacío.' });

    const file = path.join(os.tmpdir(), `voxready-nvidia-${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`);
    try {
      await fs.writeFile(file, audio);
      const result = await runAsr({ modelKey: key, filePath: file, language: model.language });
      const payload = { ...result, requestMs: Date.now() - started, bytes: audio.length, contentType, modelKey: key };
      // El estado HTTP distingue configuración del servidor, timeout y fallo del servicio
      // externo: un intérprete ausente o una clave sin cargar NO son un «Bad Gateway».
      const HTTP_FOR_CODE = { NO_KEY: 503, PYTHON_MISSING: 503, NOT_AVAILABLE: 503, TIMEOUT: 504 };
      const status = result.ok ? 200 : HTTP_FOR_CODE[result.code] || 502;
      return res.status(status).json(payload);
    } catch (error) {
      return res.status(500).json({ ok: false, code: 'INTERNAL', message: 'No se pudo procesar el audio.' });
    } finally {
      fs.unlink(file).catch(() => {});
    }
  });
};

module.exports.ALLOWED_TYPES = ALLOWED_TYPES;
