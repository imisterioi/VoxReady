const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

require('dotenv').config();
const { seedDemo, seedMetricsDemo } = require('./seed-demo');
const { LIBRARY_SCENARIOS } = require('./library-scenarios');
const { LIBRARY_SCENARIOS_EN } = require('./library-scenarios.en');

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
    update: { defaultLanguage: 'es', sector: 'Retail', status: 'ACTIVE' },
    create: {
      id: '00000000-0000-0000-0000-000000000001',
      name: 'Empresa Demo',
      sector: 'Retail',
      status: 'ACTIVE',
      defaultLanguage: 'es',
    },
  });

  const user = await prisma.user.upsert({
    where: {
      email: 'vocero@demo.com',
    },
    update: {
      name: 'Ana Torres',
      role: 'VOCERO',
      tenantId: tenant.id,
      area: 'Dirección',
      language: 'es',
    },
    create: {
      name: 'Ana Torres',
      email: 'vocero@demo.com',
      role: 'VOCERO',
      tenantId: tenant.id,
      area: 'Dirección',
      language: 'es',
    },
  });

  const admin = await prisma.user.upsert({
    where: {
      email: 'admin@demo.com',
    },
    update: {
      name: 'Carlos Ruiz',
      role: 'ADMIN',
      tenantId: tenant.id,
      language: 'es',
    },
    create: {
      name: 'Carlos Ruiz',
      email: 'admin@demo.com',
      role: 'ADMIN',
      tenantId: tenant.id,
      language: 'es',
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

  // Escenarios personalizados del vocero: contenido en español con `language` EXPLÍCITO (no se
  // depende del valor por defecto del esquema). `upsert` por (tenantId, title) → idempotente.
  for (const data of scenarioData) {
    const payload = {
      context: data.context,
      keyMessages: data.keyMessages,
      category: data.category,
      language: 'es',
    };

    const scenario = await prisma.theme.upsert({
      where: { tenantId_title: { tenantId: tenant.id, title: data.title } },
      update: payload,
      create: { ...payload, title: data.title, tenantId: tenant.id },
    });

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

  // Biblioteca de escenarios generales: un catálogo INDEPENDIENTE por idioma (no se traducen
  // entre sí). Cada escenario queda marcado con el idioma de su catálogo.
  const catalogs = [
    { language: 'es', scenarios: LIBRARY_SCENARIOS },
    { language: 'en', scenarios: LIBRARY_SCENARIOS_EN },
  ];
  let libraryTotal = 0;
  for (const { language, scenarios } of catalogs) {
    for (const s of scenarios) {
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
        language,
      };
      const existing = await prisma.theme.findFirst({ where: { isGlobal: true, title: s.title, language }, select: { id: true } });
      if (existing) await prisma.theme.update({ where: { id: existing.id }, data });
      else await prisma.theme.create({ data: { ...data, title: s.title } });
      libraryTotal += 1;
    }
  }
  console.log(
    `Escenarios generales: ${libraryTotal} (español: ${LIBRARY_SCENARIOS.length}, inglés: ${LIBRARY_SCENARIOS_EN.length})`,
  );

  // Datos demo para las métricas administrativas (organizaciones, usuarios, temas, asignaciones y sesiones)
  const demoCounts = await seedMetricsDemo(prisma);
  console.log(
    `Datos demo de métricas: ${demoCounts.tenants} organizaciones, ${demoCounts.admins} admins, ` +
      `${demoCounts.voceros} voceros, ${demoCounts.themes} temas, ${demoCounts.assignments} asignaciones, ${demoCounts.sessions} sesiones`,
  );

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