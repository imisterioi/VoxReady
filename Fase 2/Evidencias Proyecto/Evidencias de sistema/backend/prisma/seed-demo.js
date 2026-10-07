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

// ========================================
// DATOS DEMO — VOXREADY
// Organizaciones, usuarios, temas, asignaciones y sesiones para el dashboard
// administrativo. Idempotente (IDs y emails estables con upsert) y NO destructivo:
// no borra ni modifica datos previos; solo crea/actualiza lo suyo.
// Identificable: tenants con id fijo 'd0000000-…' y correos @demo.voxready
// (más la cuenta del sistema system.demo@voxready.local).
// ========================================

const DAY = 24 * 60 * 60 * 1000;
const uid = (n) => `d0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

// Fechas (días atrás) repartidas en/entre los períodos 7 / 30 / 90 / 365 / todo.
const METRIC_OFFSETS = [2, 4, 6, 9, 13, 20, 27, 40, 60, 80, 120, 200, 300, 400];

// Correo determinista a partir del nombre (sin acentos), dominio de demo.
const metricEmailFor = (name) =>
  `${name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z]+/g, '.')
    .replace(/^\.|\.$/g, '')}@demo.voxready`;

// Seis temas coherentes por organización (el título es único por tenant).
const METRIC_THEMES = [
  { title: 'Crisis reputacional', category: 'CRISIS', optic: 'Empática', context: 'Circulan acusaciones sobre la organización que han tomado gran visibilidad en prensa y redes sociales.', keyMessages: ['Reconocemos la situación y actuamos con transparencia.', 'Estamos investigando los hechos con rigor.', 'Informaremos avances a la brevedad.'], redLines: ['Culpar a terceros sin evidencia.', 'Minimizar el impacto real.'] },
  { title: 'Incidente operacional', category: 'CRISIS', optic: 'Informativa', context: 'Un incidente detuvo la operación y afectó a usuarios y clientes durante varias horas.', keyMessages: ['La causa está identificada.', 'La operación fue restablecida.', 'Compensaremos a los afectados.'], redLines: ['Prometer plazos no confirmados.'] },
  { title: 'Atención a medios', category: 'MEDIOS', optic: 'Informativa', context: 'Eres entrevistado en vivo sobre el desempeño reciente de la organización.', keyMessages: ['Los resultados reflejan nuestra gestión.', 'Seguimos invirtiendo en las personas.'], redLines: ['Evadir preguntas incómodas.'] },
  { title: 'Seguridad de la información', category: 'INSTITUCIONAL', optic: 'Informativa', context: 'Se detectó un intento de acceso indebido a sistemas internos.', keyMessages: ['Activamos nuestros protocolos de seguridad.', 'Notificamos a la autoridad competente.'], redLines: ['Revelar detalles que comprometan la seguridad.'] },
  { title: 'Comunicación interna', category: 'INSTITUCIONAL', optic: 'Cercana', context: 'Debes comunicar un cambio importante a los equipos internos.', keyMessages: ['Explicamos el motivo del cambio.', 'Acompañaremos a cada equipo en la transición.'], redLines: ['Generar incertidumbre innecesaria.'] },
  { title: 'Problemas con clientes', category: 'GENERAL', optic: 'Empática', context: 'Un grupo de clientes expresa insatisfacción por la calidad del servicio.', keyMessages: ['Escuchamos y nos hacemos cargo.', 'Implementaremos mejoras concretas.'], redLines: ['Descalificar a los clientes.'] },
];

// Organizaciones demo (mismos IDs que antes → upsert actualiza, no duplica) con sus
// voceros y la cantidad de entrenamientos (para que los rankings sean claros).
const METRIC_ORGS = [
  {
    tenant: { id: uid(1), name: 'Energía Litoral', sector: 'Energía', status: 'ACTIVE', daysAgo: 500 },
    admin: 'Administrador Litoral',
    voceros: [
      { name: 'Valentina Ríos', area: 'Dirección', sessions: 14 },
      { name: 'Martín Cáceres', area: 'Planta', sessions: 6 },
      { name: 'Josefa Núñez', area: 'Técnicos', sessions: 2 },
      { name: 'Ignacio Fuentes', area: 'Dirección', sessions: 0 },
      { name: 'Paula Medina', area: 'Planta', status: 'SUSPENDED', sessions: 3 },
      { name: 'Rodrigo Salas', area: 'Técnicos', anonymized: true, sessions: 2 },
    ],
  },
  {
    tenant: { id: uid(2), name: 'Banco Meridiano', sector: 'Banca', status: 'ACTIVE', daysAgo: 300 },
    admin: 'Administrador Meridiano',
    voceros: [
      { name: 'Camila Ortiz', area: 'Dirección', sessions: 10 },
      { name: 'Andrés Bravo', area: 'Planta', sessions: 5 },
      { name: 'Fernanda López', area: 'Técnicos', sessions: 1 },
      { name: 'Sebastián Rojas', area: 'Dirección', sessions: 0 },
      { name: 'Daniela Vega', area: 'Planta', status: 'SUSPENDED', sessions: 2 },
    ],
  },
  {
    tenant: { id: uid(3), name: 'Clínica Salud Vital', sector: 'Salud', status: 'ACTIVE', daysAgo: 60 },
    admin: 'Administradora Vital',
    voceros: [
      { name: 'Katherine Muñoz', area: 'Dirección', sessions: 7 },
      { name: 'Felipe Aravena', area: 'Planta', sessions: 3 },
      { name: 'Antonia Sepúlveda', area: 'Técnicos', sessions: 0 },
      { name: 'Matías Herrera', area: 'Dirección', sessions: 1 },
    ],
  },
  {
    tenant: { id: uid(4), name: 'Transportes Norte', sector: 'Logística', status: 'SUSPENDED', daysAgo: 20 },
    admin: 'Administrador Norte',
    voceros: [
      { name: 'Ricardo Peña', area: 'Dirección', sessions: 4 },
      { name: 'Pamela Contreras', area: 'Planta', sessions: 2 },
      { name: 'Cristóbal Silva', area: 'Técnicos', sessions: 0 },
    ],
  },
];

// ---- Constructores de contenido demo (deterministas, sin dependencias) ----
const det = (seed) => {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
};
const entre = (seed, min, max) => Math.round(min + det(seed) * (max - min));
const metricList = (value) => {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [value];
  } catch {
    return [value];
  }
};

function metricMetrics(seed) {
  return {
    voice: {
      available: true,
      wpm: entre(seed + 1, 110, 165),
      fillersPerMin: Number((det(seed + 2) * 4).toFixed(1)),
      longPauses: entre(seed + 3, 0, 4),
      volumeVariation: Number((0.1 + det(seed + 4) * 0.3).toFixed(2)),
      fillerWords: ['eh', 'este', 'o sea'].slice(0, entre(seed + 5, 1, 3)),
    },
    body: {
      available: true,
      facingCamera: Number((0.7 + det(seed + 6) * 0.3).toFixed(2)),
      presence: Number((0.7 + det(seed + 7) * 0.3).toFixed(2)),
      shoulderTilt: Number((det(seed + 8) * 4).toFixed(1)),
      headMovement: Number((0.002 + det(seed + 9) * 0.006).toFixed(4)),
      handActivity: Number((0.003 + det(seed + 10) * 0.012).toFixed(4)),
    },
    lighting: { average: entre(seed + 11, 120, 200) },
  };
}

const PREGUNTAS = ['¿Cuál es su reacción ante esta situación?', '¿Qué medidas concretas están tomando?', '¿Cómo responde a las críticas de estos días?', '¿Cuándo se restablecerá la normalidad?', '¿Qué le diría a los afectados?'];
const RESPUESTAS = [
  'Lamentamos profundamente lo ocurrido y estamos trabajando sin descanso para resolverlo.',
  'Ya desplegamos equipos en terreno y la causa está identificada.',
  'Asumimos nuestra responsabilidad y respondemos con transparencia.',
  'Estamos priorizando a las personas afectadas y compensaremos a quienes corresponda.',
  'Entendemos la molestia; nuestro compromiso es informar con claridad y cumplir.',
];

function metricTranscript(seed, turns = 5) {
  return Array.from({ length: turns }, (_, i) => ({
    question: PREGUNTAS[i % PREGUNTAS.length],
    answer: RESPUESTAS[(i + Math.round(det(seed + i) * 3)) % RESPUESTAS.length],
    metrics: { wpm: entre(seed + i, 110, 160), fillers: i % 4, latencyMs: 800 + i * 120 },
  }));
}

function metricReport(theme, global, seed) {
  const area = (s) => Math.max(0, Math.min(100, Math.round(global + det(s) * 12 - 6)));
  const areas = [
    { key: 'expression', label: 'Expresión', score: area(seed + 11), weight: 25, details: [], source: 'Cámara (MediaPipe)' },
    { key: 'voice', label: 'Tono de voz', score: area(seed + 12), weight: 25, details: [], source: 'Micrófono' },
    { key: 'coherence', label: 'Coherencia', score: area(seed + 13), weight: 30, details: [], source: 'IA evaluadora' },
    { key: 'empathy', label: 'Empatía', score: area(seed + 14), weight: 20, details: [], source: 'IA evaluadora' },
  ];
  return {
    global,
    areas,
    weights: { expression: 25, voice: 25, coherence: 30, empathy: 20 },
    pattern: null,
    patternVersion: null,
    strictness: 'normal',
    resumen: 'Evaluación demo: buena disposición y mensajes claros; hay margen para sostener mejor los mensajes clave.',
    cita: 'Mantuviste un tono sereno y miraste a cámara, aunque al inicio tardaste en responder.',
    fortalezas: ['Tono sereno', 'Mensajes claros', 'Buena presencia'],
    mejoras: ['Responder más rápido', 'Reducir muletillas', 'Reforzar los mensajes clave'],
    mensajesClave: metricList(theme.keyMessages).map((m, i) => ({ mensaje: m, cubierto: i % 2 === 0 })),
    lineasRojas: metricList(theme.redLines).map((l) => ({ linea: l, cruzada: false, evidencia: '' })),
    porPregunta: [1, 2, 3, 4, 5].map((n) => ({ pregunta: n, puntaje: area(seed + n), comentario: 'Respuesta clara y ordenada.' })),
    measured: metricMetrics(seed),
    ai: { evaluator: 'demo', ms: 0 },
    generatedAt: new Date().toISOString(),
  };
}

function metricReview(global) {
  const area = (d) => Math.max(0, Math.min(100, Math.round(global + d)));
  return {
    scores: { expression: area(2), voice: area(-3), coherence: area(4), empathy: area(-6) },
    comment: 'Revisión demo conforme con la evaluación automática.',
    reviewer: { id: 'demo-reviewer', name: 'Equipo maestro (demo)' },
    at: new Date().toISOString(),
    agreement: { expression: 2, voice: 3, coherence: 4, empathy: 6 },
  };
}

async function seedMetricsDemo(prisma) {
  const counts = { tenants: 0, admins: 0, voceros: 0, themes: 0, assignments: 0, sessions: 0 };
  let seq = 0; // contador de sesiones (IDs deterministas → idempotencia)
  let n = 0; // índice global de sesión (para variar el contenido demo)
  const nextSessionId = () => uid(700000 + seq++);

  // Cuenta del Administrador del Sistema (SYSTEM, sin tenant). Se AGREGA; no reemplaza
  // a la cuenta SYSTEM existente del proyecto.
  await prisma.user.upsert({
    where: { email: 'system.demo@voxready.local' },
    update: { name: 'Administrador del Sistema (demo)', role: 'SYSTEM', status: 'ACTIVE', tenantId: null, passwordHash: hashPassword(DEMO_PASSWORD) },
    create: { email: 'system.demo@voxready.local', name: 'Administrador del Sistema (demo)', role: 'SYSTEM', status: 'ACTIVE', tenantId: null, passwordHash: hashPassword(DEMO_PASSWORD) },
  });

  for (const org of METRIC_ORGS) {
    // Organización (mismo ID → upsert actualiza, no duplica)
    const tenant = await prisma.tenant.upsert({
      where: { id: org.tenant.id },
      update: { name: org.tenant.name, sector: org.tenant.sector, status: org.tenant.status },
      create: { id: org.tenant.id, name: org.tenant.name, sector: org.tenant.sector, status: org.tenant.status, createdAt: new Date(Date.now() - org.tenant.daysAgo * DAY) },
    });
    counts.tenants += 1;

    // ADMIN de la organización (siempre con tenant)
    const adminEmail = metricEmailFor(org.admin);
    const adminData = { name: org.admin, role: 'ADMIN', status: 'ACTIVE', tenantId: tenant.id, passwordHash: hashPassword(DEMO_PASSWORD) };
    await prisma.user.upsert({ where: { email: adminEmail }, update: adminData, create: { email: adminEmail, ...adminData } });
    counts.admins += 1;

    // Temas de la organización (6, coherentes con el sector)
    const themes = [];
    for (const t of METRIC_THEMES) {
      const themeData = { category: t.category, optic: t.optic, context: t.context, keyMessages: JSON.stringify(t.keyMessages), redLines: JSON.stringify(t.redLines), availableToAllVoceros: true, tenantId: tenant.id };
      const theme = await prisma.theme.upsert({
        where: { tenantId_title: { tenantId: tenant.id, title: t.title } },
        update: themeData,
        create: { title: t.title, ...themeData },
      });
      themes.push(theme);
      counts.themes += 1;
    }

    // Voceros + sesiones + asignaciones
    for (const v of org.voceros) {
      const email = metricEmailFor(v.name);
      const userData = { name: v.name, role: 'VOCERO', area: v.area, status: v.status || 'ACTIVE', anonymizedAt: v.anonymized ? new Date() : null, tenantId: tenant.id, passwordHash: v.anonymized ? null : hashPassword(DEMO_PASSWORD) };
      const user = await prisma.user.upsert({ where: { email }, update: userData, create: { email, ...userData } });
      counts.voceros += 1;

      const usedThemes = new Map(); // themeId → última fecha de sesión (para el estado de la asignación)
      for (let i = 0; i < v.sessions; i += 1) {
        const daysAgo = METRIC_OFFSETS[i % METRIC_OFFSETS.length];
        const theme = themes[i % themes.length];
        const created = new Date(Date.now() - daysAgo * DAY);
        const score = 62 + ((i * 7 + (n % 5) * 4) % 30);
        const seed = (n + 1) * 3.7 + i;
        const data = {
          status: 'COMPLETED',
          score,
          completedAt: created,
          createdAt: created,
          userId: user.id,
          themeId: theme.id,
          tenantId: tenant.id,
          transcript: metricTranscript(seed),
          metrics: metricMetrics(seed),
          report: metricReport(theme, score, seed),
          review: i % 3 === 0 ? metricReview(score) : null,
        };
        // ID determinista (misma secuencia que antes) → upsert actualiza en sitio.
        await prisma.session.upsert({ where: { id: nextSessionId() }, update: data, create: { ...data, id: uid(700000 + seq - 1) } });
        counts.sessions += 1;
        usedThemes.set(theme.id, created);
        n += 1;
      }

      // Asignaciones: todos los temas de la organización; COMPLETED si el vocero
      // tuvo alguna sesión en ese tema (coherente con las sesiones creadas).
      for (const theme of themes) {
        await prisma.scenarioAssignment.upsert({
          where: { userId_themeId: { userId: user.id, themeId: theme.id } },
          update: {},
          create: {
            userId: user.id,
            themeId: theme.id,
            status: usedThemes.has(theme.id) ? 'COMPLETED' : 'PENDING',
            assignedAt: new Date(Date.now() - 320 * DAY),
            completedAt: usedThemes.get(theme.id) || null,
          },
        });
        counts.assignments += 1;
      }
    }
  }

  return counts;
}

module.exports = { seedDemo, DEMO_PASSWORD, seedMetricsDemo };

