const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

require('dotenv').config();

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL
});

const prisma = new PrismaClient({
  adapter
});

async function main() {
  console.log('Creando datos de prueba...');

  // Crear organización
  const tenant = await prisma.tenant.create({
    data: {
      name: 'Empresa Demo'
    }
  });

  // Crear vocero
  const user = await prisma.user.create({
    data: {
      name: 'Vocero Demo',
      email: 'vocero@demo.com',
      role: 'VOCERO',
      tenantId: tenant.id
    }
  });

  // Crear escenarios
  const scenarios = await Promise.all([
    prisma.theme.create({
      data: {
        title: 'Crisis por falla de servicio',
        context: 'La organización enfrenta una interrupción inesperada de un servicio importante.',
        keyMessages: 'Explicar qué ocurrió, qué medidas se están tomando y cómo se solucionará.',
        category: 'CRISIS',
        tenantId: tenant.id
      }
    }),

    prisma.theme.create({
      data: {
        title: 'Incidente de seguridad',
        context: 'Se produjo un incidente que requiere comunicación pública de la organización.',
        keyMessages: 'Explicar los hechos confirmados, las medidas tomadas y los próximos pasos.',
        category: 'CRISIS',
        tenantId: tenant.id
      }
    }),

    prisma.theme.create({
      data: {
        title: 'Entrevista sobre resultados',
        context: 'Un medio de comunicación entrevista al vocero sobre los resultados de la organización.',
        keyMessages: 'Presentar los principales resultados y explicar su impacto.',
        category: 'MEDIOS',
        tenantId: tenant.id
      }
    }),

    prisma.theme.create({
      data: {
        title: 'Presentación ante medios',
        context: 'El vocero debe entregar información institucional frente a periodistas.',
        keyMessages: 'Comunicar los mensajes principales de manera clara y coherente.',
        category: 'MEDIOS',
        tenantId: tenant.id
      }
    }),

    prisma.theme.create({
      data: {
        title: 'Cambio de política interna',
        context: 'La organización implementará una nueva política que debe ser comunicada.',
        keyMessages: 'Explicar el motivo del cambio, sus objetivos y cómo afectará a la organización.',
        category: 'INSTITUCIONAL',
        tenantId: tenant.id
      }
    })
  ]);

  // Asignar todos los escenarios al vocero
  for (const scenario of scenarios) {
    await prisma.scenarioAssignment.create({
      data: {
        userId: user.id,
        themeId: scenario.id
      }
    });
  }

  console.log('Datos creados correctamente.');
  console.log(`Usuario: ${user.email}`);
  console.log(`Escenarios asignados: ${scenarios.length}`);
}

main()
  .catch((error) => {
    console.error('Error ejecutando seed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });