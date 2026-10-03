// Importar las librerías necesarias
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');

const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
require('dotenv').config();
// Claves privadas (API de IA) en un archivo que git ignora
require('dotenv').config({ path: path.join(__dirname, '.env.local') });
const { generateQuestion, warmUp } = require('./ai/interviewer');
const { requireAuth } = require('./auth');
const registerAccountRoutes = require('./routes/accounts');
const registerSessionRoutes = require('./routes/sessions');
const registerPatternRoutes = require('./routes/patterns');
const registerThemeRoutes = require('./routes/themes');
const registerDeletionRoutes = require('./routes/deletionRequests');

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
registerSessionRoutes(app, prisma);
registerPatternRoutes(app, prisma);
registerThemeRoutes(app, prisma);
registerDeletionRoutes(app, prisma);

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

app.get('/api/scenarios/my', async (req, res) => {
  try {
    const email = req.query.email;

    if (!email) {
      return res.status(400).json({
        status: 'error',
        mensaje: 'Debes indicar el correo del usuario'
      });
    }

    const user = await prisma.user.findUnique({
      where: {
        email
      }
    });

    if (!user) {
      return res.status(404).json({
        status: 'error',
        mensaje: 'Usuario no encontrado'
      });
    }

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

    const scenarios = assignments.map((assignment) => ({
      assignmentId: assignment.id,
      id: assignment.theme.id,
      title: assignment.theme.title,
      context: assignment.theme.context,
      keyMessages: assignment.theme.keyMessages,
      redLines: assignment.theme.redLines,
      optic: assignment.theme.optic,
      publics: assignment.theme.publics,
      category: assignment.theme.category,
      status: assignment.status,
      assignedAt: assignment.assignedAt
    }));

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

app.post('/api/sessions', async (req, res) => {
  try {
    const { email, themeId } = req.body;

    if (!email || !themeId) {
      return res.status(400).json({
        status: 'error',
        mensaje: 'Faltan email o themeId'
      });
    }

    const user = await prisma.user.findUnique({
      where: {
        email
      }
    });

    if (!user) {
      return res.status(404).json({
        status: 'error',
        mensaje: 'Usuario no encontrado'
      });
    }

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

    if (theme.tenantId !== user.tenantId) {
      return res.status(403).json({
        status: 'error',
        mensaje: 'El escenario no pertenece al tenant del usuario'
      });
    }

    const assignment = await prisma.scenarioAssignment.findUnique({
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

// Subida de la grabación de una sesión (un único endpoint, autenticado).
// Solo el vocero dueño de la sesión puede subir su propio .webm.
app.post('/api/sessions/:id/video', requireAuth(prisma), async (req, res) => {
  const sessionId = req.params.id;

  const filePath = path.join(
    sessionsDir,
    `${sessionId}.webm`
  );

  try {
    const session = await prisma.session.findUnique({
      where: {
        id: sessionId
      }
    });

    if (!session) {
      return res.status(404).json({
        status: 'error',
        mensaje: 'Sesión no encontrada'
      });
    }

    if (session.userId !== req.user.id) {
      return res.status(403).json({
        status: 'error',
        mensaje: 'No puedes subir la grabación de otra sesión'
      });
    }

    const writeStream = fs.createWriteStream(filePath);

    await pipeline(req, writeStream);

    await prisma.session.update({
      where: {
        id: sessionId
      },
      data: {
        status: 'COMPLETED'
      }
    });

    res.json({
      status: 'ok',
      mensaje: 'Video guardado correctamente',
      file: `${sessionId}.webm`
    });

  } catch (error) {
    console.error('Error guardando video:', error);

    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (deleteError) {
      console.error('Error eliminando archivo incompleto:', deleteError);
    }

    res.status(500).json({
      status: 'error',
      mensaje: 'No se pudo guardar el video'
    });
  }
});

// Crear y publicar un nuevo patrón maestro
app.post('/api/master-pattern', async (req, res) => {
  try {
    const {
      email,
      expressionWeight,
      voiceToneWeight,
      coherenceWeight,
      empathyWeight,
      empathyLevel,
      empathyDescription
    } = req.body;

    // 1. Validar campos obligatorios
    if (
      !email ||
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

    // 5. Buscar al configurador maestro
    const user = await prisma.user.findUnique({
      where: {
        email
      }
    });

    if (!user) {
      return res.status(404).json({
        status: 'error',
        mensaje: 'Usuario no encontrado'
      });
    }

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

// Entrevistador IA: devuelve la siguiente pregunta según el escenario y la conversación
// Body: { themeId?: string, history?: [{ role: 'interviewer' | 'vocero', text: string }] }
app.post('/api/interviewer/next-question', async (req, res) => {
  try {
    const { themeId, history = [] } = req.body || {};

    let theme = null;
    if (themeId) {
      theme = await prisma.theme.findUnique({ where: { id: themeId } });
    }

    const result = await generateQuestion({ theme, history });

    res.json({
      status: 'ok',
      question: result.question,
      model: result.model,
      ms: result.ms
    });
  } catch (error) {
    console.error('Error generando pregunta:', error.message);

    res.status(error.code === 'NO_API_KEY' ? 503 : 502).json({
      status: 'error',
      mensaje: error.code === 'NO_API_KEY'
        ? 'La IA no está configurada: falta NVIDIA_API_KEY en backend/.env.local'
        : 'El entrevistador IA no respondió. Intenta de nuevo.'
    });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor backend de VoxReady corriendo en http://localhost:${PORT}`);
  warmUp();
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


