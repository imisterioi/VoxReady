// Importar las librerías necesarias
const express = require('express');
const cors = require('cors');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

require('dotenv').config();

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

app.listen(PORT, () => {
  console.log(`Servidor backend de VoxReady corriendo en http://localhost:${PORT}`);
});