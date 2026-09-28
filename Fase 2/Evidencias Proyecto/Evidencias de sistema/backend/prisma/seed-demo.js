// Datos de demostración adicionales: cuentas con contraseña para los 4 roles,
// una segunda organización y el "escenario de prueba integral".
// Se ejecuta desde seed.js y es idempotente (se puede correr varias veces).
const { hashPassword } = require('../auth');

const DEMO_PASSWORD = 'demo1234';

const INTEGRAL_SCENARIO = {
  title: 'Prueba integral: corte masivo de suministro',
  category: 'CRISIS',
  optic: 'Empática',
  context:
    'Un corte eléctrico no programado dejó sin suministro a 80.000 hogares durante 14 horas, incluyendo pacientes electrodependientes. ' +
    'La empresa tardó 6 horas en emitir el primer comunicado y en redes sociales circulan denuncias de clientes sin información. ' +
    'Eres el vocero y enfrentas una entrevista en vivo con un periodista de televisión.',
  keyMessages: [
    'Lamentamos profundamente el impacto en las familias afectadas, especialmente en los pacientes electrodependientes.',
    'El 100% del suministro ya fue restablecido y la causa fue una falla en la subestación Los Aromos.',
    'Compensaremos a todos los clientes afectados de forma automática en su próxima boleta.',
    'Revisaremos nuestro protocolo de comunicación para informar en menos de una hora.',
  ],
  redLines: [
    'Culpar a los clientes, al clima o a terceros sin evidencia.',
    'Minimizar el impacto diciendo que "no fue tan grave".',
    'Prometer plazos o montos que no están confirmados.',
  ],
  publics: ['Dirección', 'Planta', 'Técnicos'],
};

async function upsertUser(prisma, { email, name, role, tenantId = null, area = null }) {
  return prisma.user.upsert({
    where: { email },
    update: { name, role, tenantId, area, status: 'ACTIVE', passwordHash: hashPassword(DEMO_PASSWORD) },
    create: { email, name, role, tenantId, area, status: 'ACTIVE', passwordHash: hashPassword(DEMO_PASSWORD) },
  });
}

async function upsertIntegralScenario(prisma, tenantId) {
  const data = {
    context: INTEGRAL_SCENARIO.context,
    keyMessages: JSON.stringify(INTEGRAL_SCENARIO.keyMessages),
    redLines: JSON.stringify(INTEGRAL_SCENARIO.redLines),
    publics: JSON.stringify(INTEGRAL_SCENARIO.publics),
    optic: INTEGRAL_SCENARIO.optic,
    category: INTEGRAL_SCENARIO.category,
    availableToAllVoceros: true,
  };
  return prisma.theme.upsert({
    where: { tenantId_title: { tenantId, title: INTEGRAL_SCENARIO.title } },
    update: data,
    create: { ...data, title: INTEGRAL_SCENARIO.title, tenantId },
  });
}

async function assign(prisma, userId, themeId) {
  return prisma.scenarioAssignment.upsert({
    where: { userId_themeId: { userId, themeId } },
    update: {},
    create: { userId, themeId },
  });
}

async function seedDemo(prisma, { tenant, scenarios }) {
  // Organización principal (la "Empresa Demo" del seed original)
  await prisma.tenant.update({ where: { id: tenant.id }, data: { sector: 'Retail', status: 'ACTIVE' } });

  // Segunda organización
  const andes = await prisma.tenant.upsert({
    where: { id: '00000000-0000-0000-0000-000000000002' },
    update: { status: 'ACTIVE' },
    create: { id: '00000000-0000-0000-0000-000000000002', name: 'Energía Andes', sector: 'Energía' },
  });

  // Cuentas (contraseña: demo1234)
  const accounts = [
    await upsertUser(prisma, { email: 'sofia@voxready.io', name: 'Sofía Reyes', role: 'SYSTEM' }),
    await upsertUser(prisma, { email: 'marta@voxready.io', name: 'Marta Vidal', role: 'MASTER' }),
    await upsertUser(prisma, { email: 'admin@demo.com', name: 'Carlos Ruiz', role: 'ADMIN', tenantId: tenant.id }),
    await upsertUser(prisma, { email: 'vocero@demo.com', name: 'Ana Torres', role: 'VOCERO', tenantId: tenant.id, area: 'Dirección' }),
    await upsertUser(prisma, { email: 'diego@demo.com', name: 'Diego Paredes', role: 'VOCERO', tenantId: tenant.id, area: 'Planta' }),
    await upsertUser(prisma, { email: 'lucia@andes.cl', name: 'Lucía Soto', role: 'ADMIN', tenantId: andes.id }),
    await upsertUser(prisma, { email: 'tomas@andes.cl', name: 'Tomás Rivas', role: 'VOCERO', tenantId: andes.id, area: 'Técnicos' }),
  ];

  // Escenario de prueba integral en ambas organizaciones, disponible para todos sus voceros
  const integralDemo = await upsertIntegralScenario(prisma, tenant.id);
  const integralAndes = await upsertIntegralScenario(prisma, andes.id);

  const diego = accounts.find((u) => u.email === 'diego@demo.com');
  const ana = accounts.find((u) => u.email === 'vocero@demo.com');
  const tomas = accounts.find((u) => u.email === 'tomas@andes.cl');

  for (const scenario of scenarios) await assign(prisma, diego.id, scenario.id);
  await assign(prisma, ana.id, integralDemo.id);
  await assign(prisma, diego.id, integralDemo.id);
  await assign(prisma, tomas.id, integralAndes.id);

  console.log('\nCuentas de prueba (contraseña: demo1234):');
  for (const u of accounts) console.log(`  ${u.role.padEnd(7)} ${u.email}`);
  console.log(`Escenario integral: "${INTEGRAL_SCENARIO.title}"`);
}

module.exports = { seedDemo, DEMO_PASSWORD };
