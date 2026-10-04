const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

require('dotenv').config();
const { seedDemo } = require('./seed-demo');
const { LIBRARY_SCENARIOS } = require('./library-scenarios');

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
});

const prisma = new PrismaClient({
  adapter,
});

async function main() {
  console.log('Creando/verificando datos de prueba...');

  const tenant = await prisma.tenant.upsert({
    where: {
      id: '00000000-0000-0000-0000-000000000001',
    },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000001',
      name: 'Empresa Demo',
    },
  });

  const user = await prisma.user.upsert({
    where: {
      email: 'vocero@demo.com',
    },
    update: {
      name: 'Vocero Demo',
      role: 'VOCERO',
      tenantId: tenant.id,
    },
    create: {
      name: 'Vocero Demo',
      email: 'vocero@demo.com',
      role: 'VOCERO',
      tenantId: tenant.id,
    },
  });

  const admin = await prisma.user.upsert({
    where: {
      email: 'admin@demo.com',
    },
    update: {
      name: 'Administrador Demo',
      role: 'ADMIN',
      tenantId: tenant.id,
    },
    create: {
      name: 'Administrador Demo',
      email: 'admin@demo.com',
      role: 'ADMIN',
      tenantId: tenant.id,
    },
  });

  const scenarioData = [
    {
      title: 'Crisis por falla de servicio',
      context:
        'La organización enfrenta una interrupción inesperada de un servicio importante.',
      keyMessages:
        'Explicar qué ocurrió, qué medidas se están tomando y cómo se solucionará.',
      category: 'CRISIS',
    },
    {
      title: 'Incidente de seguridad',
      context:
        'Se produjo un incidente que requiere comunicación pública de la organización.',
      keyMessages:
        'Explicar los hechos confirmados, las medidas tomadas y los próximos pasos.',
      category: 'CRISIS',
    },
    {
      title: 'Entrevista sobre resultados',
      context:
        'Un medio de comunicación entrevista al vocero sobre los resultados de la organización.',
      keyMessages:
        'Presentar los principales resultados y explicar su impacto.',
      category: 'MEDIOS',
    },
    {
      title: 'Presentación ante medios',
      context:
        'El vocero debe entregar información institucional frente a periodistas.',
      keyMessages:
        'Comunicar los mensajes principales de manera clara y coherente.',
      category: 'MEDIOS',
    },
    {
      title: 'Cambio de política interna',
      context:
        'La organización implementará una nueva política que debe ser comunicada.',
      keyMessages:
        'Explicar el motivo del cambio, sus objetivos y cómo afectará a la organización.',
      category: 'INSTITUCIONAL',
    },
  ];

  const scenarios = [];

  for (const data of scenarioData) {
    const existingScenario = await prisma.theme.findFirst({
      where: {
        title: data.title,
        tenantId: tenant.id,
      },
      select: {
        id: true,
      },
    });

    let scenario;

    if (existingScenario) {
      scenario = await prisma.theme.update({
        where: {
          id: existingScenario.id,
        },
        data: {
          context: data.context,
          keyMessages: data.keyMessages,
          category: data.category,
        },
      });
    } else {
      scenario = await prisma.theme.create({
        data: {
          title: data.title,
          context: data.context,
          keyMessages: data.keyMessages,
          category: data.category,
          tenantId: tenant.id,
        },
      });
    }

    scenarios.push(scenario);
  }

  for (const scenario of scenarios) {
    await prisma.scenarioAssignment.upsert({
      where: {
        userId_themeId: {
          userId: user.id,
          themeId: scenario.id,
        },
      },
      update: {},
      create: {
        userId: user.id,
        themeId: scenario.id,
      },
    });
  }

  // Cuentas con contraseña, segunda organización y escenario de prueba integral
  await seedDemo(prisma, { tenant, scenarios });

  // Biblioteca de escenarios generales (sin organización, visibles para todos los voceros)
  for (const s of LIBRARY_SCENARIOS) {
    const data = {
      context: s.context,
      category: s.category,
      optic: s.optic,
      keyMessages: JSON.stringify(s.keyMessages),
      redLines: JSON.stringify(s.redLines),
      publics: JSON.stringify([]),
      isGlobal: true,
      tenantId: null,
      deletedAt: null,
    };
    const existing = await prisma.theme.findFirst({ where: { isGlobal: true, title: s.title }, select: { id: true } });
    if (existing) await prisma.theme.update({ where: { id: existing.id }, data });
    else await prisma.theme.create({ data: { ...data, title: s.title } });
  }
  console.log(`Escenarios generales: ${LIBRARY_SCENARIOS.length}`);

  console.log('Datos creados/verificados correctamente.');
  console.log(`Administrador: ${admin.email}`);
  console.log(`Vocero: ${user.email}`);
  console.log(`Escenarios: ${scenarios.length}`);
}

main()
  .catch((error) => {
    console.error('Error ejecutando seed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });