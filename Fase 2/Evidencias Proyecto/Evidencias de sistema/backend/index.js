// Importar las librerías necesarias
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { createMediaUploadHandler } = require('./lib/mediaUpload');

const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
require('dotenv').config();
// Claves privadas (API de IA) en un archivo que git ignora
require('dotenv').config({ path: path.join(__dirname, '.env.local') });
const { generateQuestion, warmUp, askModelFromContext, interviewModels, interviewTimeoutMs } = require('./ai/interviewer');
const { createInterviewSession } = require('./lib/interviewSession');
const interviewRegistry = require('./lib/interviewRegistry');
const { LIMITS: INTERVIEW_LIMITS, normalizeInterviewConfig, resolveInterviewConfig, turnPlan, invalidInterviewConfigPayload } = require('./ai/interviewConfig');
const { requireAuth } = require('./auth');
const registerAccountRoutes = require('./routes/accounts');
const registerSessionRoutes = require('./routes/sessions');
const registerPatternRoutes = require('./routes/patterns');
const registerThemeRoutes = require('./routes/themes');
const registerDeletionRoutes = require('./routes/deletionRequests');
const registerLibraryRoutes = require('./routes/library');
const registerMetricsRoutes = require('./routes/metrics');
const registerSystemRoutes = require('./routes/system');
const registerLabRoutes = require('./routes/lab');
const registerInterviewerRoutes = require('./routes/interviewer');
const registerNvidiaLabRoutes = require('./routes/nvidiaLab');
const { processPendingTenantDeletions } = require('./lib/tenantDeletion');
const { registerJob, runJob } = require('./lib/runtimeStatus');

// Inicializar Express y Prisma
const app = express();
const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL
});

const prisma = new PrismaClient({
  adapter
});

// Configurar middlewares básicos
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// Cuentas (login, organizaciones, usuarios) y resultados de sesiones
registerAccountRoutes(app, prisma);
registerSessionRoutes(app, prisma, {
  // Recuperación automática: al arrancar reanuda evaluaciones interrumpidas y ejecuta los
  // reintentos programados (3 min, o 15 min cada 5 intentos, hasta 50 por sesión).
  evaluationQueue: { enabled: true },
});
registerPatternRoutes(app, prisma);
registerThemeRoutes(app, prisma);
registerDeletionRoutes(app, prisma);
registerLibraryRoutes(app, prisma);
registerMetricsRoutes(app, prisma);
registerSystemRoutes(app, prisma);
registerLabRoutes(app, prisma); // Laboratorio de transcripción (experimental)
registerNvidiaLabRoutes(app, prisma); // Laboratorio NVIDIA Build (experimental)

// Endpoint de prueba
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'VoxReady API',
    mensaje: '¡El backend está vivo y funcionando!'
  });
});

// Endpoint para comprobar la conexión con PostgreSQL mediante Prisma
app.get('/api/db-test', async (req, res) => {
  try {
    const result = await prisma.$queryRaw`SELECT NOW() AS fecha`;

    res.json({
      status: 'ok',
      database: 'PostgreSQL',
      prisma: 'conectado',
      fecha: result[0].fecha
    });
  } catch (error) {
    console.error('Error conectando con la base de datos:', error);

    res.status(500).json({
      status: 'error',
      mensaje: 'No se pudo conectar con la base de datos'
    });
  }
});

// Definir el puerto y encender el servidor
const PORT = process.env.PORT || 3000;

app.get('/api/scenarios/my', requireAuth(prisma), async (req, res) => {
  try {
    // El usuario se determina EXCLUSIVAMENTE desde el token (req.user).
    // Cualquier ?email= enviado por el cliente se ignora (no selecciona identidad).
    const user = req.user;

    // Los temas marcados como "disponible para todos los voceros" se asignan automáticamente
    if (user.tenantId) {
      const openThemes = await prisma.theme.findMany({
        where: { tenantId: user.tenantId, availableToAllVoceros: true, deletedAt: null },
        select: { id: true }
      });
      for (const theme of openThemes) {
        await prisma.scenarioAssignment.upsert({
          where: { userId_themeId: { userId: user.id, themeId: theme.id } },
          update: {},
          create: { userId: user.id, themeId: theme.id }
        });
      }
    }

    const assignments = await prisma.scenarioAssignment.findMany({
      where: {
        userId: user.id,
        status: 'PENDING',
        theme: { deletedAt: null }
      },
      include: {
        theme: true
      },
      orderBy: {
        assignedAt: 'desc'
      }
    });

    const orgScenarios = assignments.filter((assignment) => !assignment.theme.isGlobal).map((assignment) => ({
      scope: 'org', // escenario de la organización del vocero
      assignmentId: assignment.id,
      id: assignment.theme.id,
      title: assignment.theme.title,
      context: assignment.theme.context,
      keyMessages: assignment.theme.keyMessages,
      redLines: assignment.theme.redLines,
      optic: assignment.theme.optic,
      publics: assignment.theme.publics,
      category: assignment.theme.category,
      interview: resolveInterviewConfig(assignment.theme),
      status: assignment.status,
      assignedAt: assignment.assignedAt
    }));

    // Escenarios generales de la biblioteca de VoxReady: todos los voceros los ven
    const globalThemes = await prisma.theme.findMany({
      where: { isGlobal: true, deletedAt: null },
      orderBy: { title: 'asc' }
    });
    const generalScenarios = globalThemes.map((theme) => ({
      scope: 'general',
      assignmentId: null,
      id: theme.id,
      title: theme.title,
      context: theme.context,
      keyMessages: theme.keyMessages,
      redLines: theme.redLines,
      optic: theme.optic,
      publics: theme.publics,
      category: theme.category,
      interview: resolveInterviewConfig(theme),
      status: 'PENDING',
      assignedAt: theme.createdAt
    }));

    const scenarios = [...orgScenarios, ...generalScenarios];

    res.json({
      status: 'ok',
      scenarios
    });

  } catch (error) {
    console.error('Error obteniendo escenarios:', error);

    res.status(500).json({
      status: 'error',
      mensaje: 'No se pudieron obtener los escenarios'
    });
  }
});

const sessionsDir = path.join(__dirname, 'uploads', 'sessions');

fs.mkdirSync(sessionsDir, { recursive: true });

app.post('/api/sessions', requireAuth(prisma), async (req, res) => {
  try {
    const { themeId } = req.body || {};

    if (!themeId) {
      return res.status(400).json({
        status: 'error',
        mensaje: 'Falta themeId'
      });
    }

    // El propietario de la sesión es SIEMPRE el usuario autenticado.
    // Un email/userId enviado por el cliente se ignora.
    const user = req.user;

    const theme = await prisma.theme.findUnique({
      where: {
        id: themeId
      }
    });

    if (!theme) {
      return res.status(404).json({
        status: 'error',
        mensaje: 'Escenario no encontrado'
      });
    }

    // Los escenarios generales (biblioteca de VoxReady) están disponibles para todos los voceros
    const isGeneral = theme.isGlobal && !theme.deletedAt;

    if (!isGeneral && theme.tenantId !== user.tenantId) {
      return res.status(403).json({
        status: 'error',
        mensaje: 'El escenario no pertenece al tenant del usuario'
      });
    }

    const assignment = isGeneral ? true : await prisma.scenarioAssignment.findUnique({
      where: {
        userId_themeId: {
          userId: user.id,
          themeId: theme.id
        }
      }
    });

    if (!assignment) {
      return res.status(403).json({
        status: 'error',
        mensaje: 'El escenario no está asignado al usuario'
      });
    }

    const session = await prisma.session.create({
      data: {
        status: 'CREATED',
        userId: user.id,
        themeId: theme.id,
        tenantId: user.tenantId
      }
    });

    res.json({
      status: 'ok',
      sessionId: session.id
    });

  } catch (error) {
    console.error('Error creando sesión:', error);

    res.status(500).json({
      status: 'error',
      mensaje: 'No se pudo crear la sesión'
    });
  }
});

// ------------------------------------------- Grabaciones de una sesión (video y audio)
// El manejador vive en lib/mediaUpload.js (autorización, estado, tamaño, tipo y limpieza).
const MAX_VIDEO_BYTES = (Number(process.env.EVAL_MAX_VIDEO_MB) || 200) * 1024 * 1024;
// 10 MB de Opus (~32 kbps) son más de 40 minutos: sobra para una entrevista.
const MAX_AUDIO_BYTES = (Number(process.env.EVAL_MAX_AUDIO_MB) || 10) * 1024 * 1024;
const mediaUpload = createMediaUploadHandler({
  prisma,
  sessionsDir,
  maxVideoBytes: MAX_VIDEO_BYTES,
  maxAudioBytes: MAX_AUDIO_BYTES,
});

app.post('/api/sessions/:id/video', requireAuth(prisma), (req, res) => mediaUpload(req, res, { kind: 'video' }));
app.post('/api/sessions/:id/audio', requireAuth(prisma), (req, res) => mediaUpload(req, res, { kind: 'audio' }));

// Crear y publicar un nuevo patrón maestro (solo MASTER y SYSTEM)
app.post('/api/master-pattern', requireAuth(prisma, ['master', 'system']), async (req, res) => {
  try {
    const {
      expressionWeight,
      voiceToneWeight,
      coherenceWeight,
      empathyWeight,
      empathyLevel,
      empathyDescription
    } = req.body;

    // 1. Validar campos obligatorios
    if (
      expressionWeight === undefined ||
      voiceToneWeight === undefined ||
      coherenceWeight === undefined ||
      empathyWeight === undefined ||
      !empathyLevel ||
      !empathyDescription?.trim()
    ) {
      return res.status(400).json({
        status: 'error',
        mensaje: 'Faltan datos obligatorios'
      });
    }

    // 2. Convertir los pesos a números
    const weights = {
      expressionWeight: Number(expressionWeight),
      voiceToneWeight: Number(voiceToneWeight),
      coherenceWeight: Number(coherenceWeight),
      empathyWeight: Number(empathyWeight)
    };

    // 3. Comprobar que sean números válidos
    const invalidWeight = Object.values(weights).some(
      (weight) => !Number.isInteger(weight) || weight < 0 || weight > 100
    );

    if (invalidWeight) {
      return res.status(400).json({
        status: 'error',
        mensaje: 'Los pesos deben ser números enteros entre 0 y 100'
      });
    }

    // 4. Comprobar que los pesos sumen exactamente 100
    const total =
      weights.expressionWeight +
      weights.voiceToneWeight +
      weights.coherenceWeight +
      weights.empathyWeight;

    if (total !== 100) {
      return res.status(400).json({
        status: 'error',
        mensaje: 'Los pesos deben sumar 100%',
        total
      });
    }

    // 5. El autor del patrón es el usuario autenticado (MASTER/SYSTEM)
    const user = req.user;

    // 6. Crear la nueva versión dentro de una transacción
    const masterPattern = await prisma.$transaction(async (tx) => {

      // Desactivar el patrón actualmente activo
      await tx.masterPattern.updateMany({
        where: {
          status: 'ACTIVE'
        },
        data: {
          status: 'INACTIVE'
        }
      });

      // Buscar la última versión existente
      const lastPattern = await tx.masterPattern.findFirst({
        orderBy: {
          version: 'desc'
        }
      });

      const nextVersion = lastPattern
        ? lastPattern.version + 1
        : 1;

      // Crear la nueva versión
      return tx.masterPattern.create({
        data: {
          version: nextVersion,
          status: 'ACTIVE',

          expressionWeight: weights.expressionWeight,
          voiceToneWeight: weights.voiceToneWeight,
          coherenceWeight: weights.coherenceWeight,
          empathyWeight: weights.empathyWeight,

          empathyLevel,
          empathyDescription: empathyDescription.trim(),

          createdById: user.id
        }
      });
    });

    // 7. Respuesta
    return res.status(201).json({
      status: 'ok',
      mensaje: 'Patrón maestro publicado correctamente',
      masterPattern
    });

  } catch (error) {
    console.error('Error creando patrón maestro:', error);

    return res.status(500).json({
      status: 'error',
      mensaje: 'No se pudo crear el patrón maestro'
    });
  }
});

// Límite de preguntas por usuario: la IA es un recurso compartido (cuota de NVIDIA)
const QUESTION_WINDOW_MS = 5 * 60 * 1000;
const QUESTION_LIMIT = 60;
const questionLog = new Map(); // userId → momentos de las últimas solicitudes

function questionAllowed(userId, now = Date.now()) {
  const recent = (questionLog.get(userId) || []).filter((at) => now - at < QUESTION_WINDOW_MS);
  if (recent.length >= QUESTION_LIMIT) {
    questionLog.set(userId, recent);
    return false;
  }
  recent.push(now);
  questionLog.set(userId, recent);
  return true;
}

// La conversación la envía el navegador: se acota antes de pasarla a la IA
function cleanHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .filter((turn) => turn && typeof turn === 'object')
    .slice(-2 * INTERVIEW_LIMITS.totalTurns)
    .map((turn) => ({
      role: turn.role === 'interviewer' ? 'interviewer' : 'vocero',
      text: String(turn.text ?? '').slice(0, 2000)
    }));
}

// Entrevistador IA: la ruta vive en routes/interviewer.js (orquestación centralizada).
registerInterviewerRoutes(app, prisma, { questionAllowed });


// Express 5 entrega los errores de arranque (por ejemplo, puerto ocupado) al callback:
// sin este manejo el proceso se cerraba en silencio a los pocos segundos
app.listen(PORT, (error) => {
  if (error) {
    console.error(
      error.code === 'EADDRINUSE'
        ? `No se pudo iniciar: el puerto ${PORT} ya lo está usando otro programa. Ciérralo o define otro puerto con PORT en backend/.env`
        : `No se pudo iniciar el servidor: ${error.message}`,
    );
    process.exit(1);
  }
  console.log(`Servidor backend de VoxReady corriendo en http://localhost:${PORT}`);
  warmUp();

  // Eliminaciones de tenants pendientes (estado DELETING persistente): al arrancar y cada 5 min.
  // Garantiza que la eliminación continúe tras un fallo o reinicio, sin depender de la petición HTTP.
  const DELETION_EVERY_MS = 5 * 60 * 1000;
  registerJob('tenant-deletion', { label: 'Eliminación de organizaciones', everyMs: DELETION_EVERY_MS });
  const runPendingDeletions = () =>
    runJob('tenant-deletion', () => processPendingTenantDeletions(prisma)).catch((e) => console.warn('[Eliminación] error:', e.message));
  setTimeout(runPendingDeletions, 6000);
  setInterval(runPendingDeletions, DELETION_EVERY_MS).unref();
});

app.post('/api/themes', requireAuth(prisma, ['admin']), async (req, res) => {
  try {
    // El administrador autenticado solo puede crear temas en su propia organización
    const user = req.user;
    const {
      title,
      context,
      keyMessages,
      category,
      optic,
      publics,
      redLines,
      availableToAllVoceros,
    } = req.body;

    if (!user.tenantId) {
      return res.status(400).json({
        error: 'El administrador no tiene una organización asociada.',
      });
    }

    if (!title || !context || !keyMessages) {
      return res.status(400).json({
        error: 'Faltan datos obligatorios.',
      });
    }

    // Configuracion de la entrevista: se valida ANTES de normalizar. Una configuracion que supera
    // el limite tecnico se rechaza con 422 (no se guarda recortada en silencio) y la duracion
    // maxima es obligatoria; mismo cuerpo que PUT /api/themes y la biblioteca de escenarios.
    const configError = invalidInterviewConfigPayload(req.body.interview, { requireDuration: req.body.interview !== undefined });
    if (configError) return res.status(422).json(configError);

    const theme = await prisma.theme.create({
      data: {
        title: title.trim(),
        context: context.trim(),

        keyMessages: JSON.stringify(keyMessages),

        category: category || 'GENERAL',

        optic: optic || null,

        publics: publics
          ? JSON.stringify(publics)
          : null,

        redLines: redLines
          ? JSON.stringify(redLines)
          : null,

        availableToAllVoceros:
          Boolean(availableToAllVoceros),

        interviewConfig: normalizeInterviewConfig(req.body.interview),

        tenantId: user.tenantId,
      },
    });

    // Asignación a voceros específicos de la organización (opcional)
    const voceroIds = Array.isArray(req.body.voceroIds) ? req.body.voceroIds : [];
    if (voceroIds.length) {
      const voceros = await prisma.user.findMany({
        where: { id: { in: voceroIds }, tenantId: user.tenantId, role: 'VOCERO' },
        select: { id: true },
      });
      for (const v of voceros) {
        await prisma.scenarioAssignment.create({ data: { userId: v.id, themeId: theme.id } });
      }
    }

    res.status(201).json({
      message: 'Escenario creado correctamente.',
      theme,
    });
  } catch (error) {
    console.error('Error creando escenario:', error);

    res.status(500).json({
      error: 'Error interno creando el escenario.',
    });
  }
});


