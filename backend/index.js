// Importar las librerías necesarias
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');

const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
require('dotenv').config();
console.log('DATABASE_URL:', process.env.DATABASE_URL);

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
app.use(express.json());

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

    const assignments = await prisma.scenarioAssignment.findMany({
      where: {
        userId: user.id,
        status: 'PENDING'
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

app.post('/api/sessions/:id/video', async (req, res) => {
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

app.post('/api/sessions/:id/video', async (req, res) => {
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

app.listen(PORT, () => {
  console.log(`Servidor backend de VoxReady corriendo en http://localhost:${PORT}`);
});


