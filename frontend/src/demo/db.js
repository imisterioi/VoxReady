// "Base de datos" del modo demostración: vive en el navegador (localStorage).
// Se siembra con datos de ejemplo la primera vez y cada cambio (crear temas,
// usuarios, prácticas…) se conserva hasta que se restablece la demo.
import { DEFAULT_CONFIG, deepMerge } from './patternConfig';
import { evaluateSession } from './evaluator';
import { nextQuestion } from './interviewer';
import { LIBRARY_SCENARIOS } from './library';

const STORAGE_KEY = 'voxready_demo_db_v3';
export const DEMO_PASSWORD = 'demo1234';

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (d, hour = 10) => {
  const date = new Date(Date.now() - d * DAY);
  date.setHours(hour, (d * 17) % 60, 0, 0);
  return date.toISOString();
};

export const uid = () =>
  globalThis.crypto?.randomUUID?.() || `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

// ------------------------------------------------------------ Escenarios

const SCENARIOS = [
  {
    key: 'integral',
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
    availableToAllVoceros: true,
  },
  {
    key: 'falla',
    title: 'Crisis por falla de servicio',
    category: 'CRISIS',
    optic: 'Empática',
    context: 'La plataforma de pagos de la empresa estuvo caída durante toda la mañana del día de pago de remuneraciones. Miles de clientes no pudieron pagar ni transferir.',
    keyMessages: [
      'Pedimos disculpas a cada cliente que no pudo realizar sus pagos.',
      'El servicio está restablecido y ningún dato de clientes se vio comprometido.',
      'Eliminaremos los cobros por atraso generados durante la falla.',
    ],
    redLines: ['Culpar al proveedor tecnológico o a terceros.', 'Minimizar diciendo que "fue menor" o que "no es tan grave".'],
    publics: ['Dirección', 'Técnicos'],
  },
  {
    key: 'seguridad',
    title: 'Incidente de seguridad',
    category: 'CRISIS',
    optic: 'Formal',
    context: 'Se detectó un acceso no autorizado a una base de datos con correos y teléfonos de clientes. No hay evidencia de que se hayan expuesto datos bancarios.',
    keyMessages: [
      'Detectamos el acceso, lo contuvimos y lo informamos a la autoridad.',
      'No se expusieron datos bancarios ni contraseñas de nuestros clientes.',
      'Contactaremos personalmente a cada cliente afectado con recomendaciones.',
    ],
    redLines: ['Prometer que "nunca más va a pasar".', 'Culpar a los clientes por usar contraseñas débiles.'],
    publics: ['Dirección'],
  },
  {
    key: 'resultados',
    title: 'Entrevista sobre resultados',
    category: 'MEDIOS',
    optic: 'Técnica',
    context: 'Un medio económico entrevista al vocero tras la publicación de los resultados anuales, con un alza en utilidades y el cierre de dos sucursales.',
    keyMessages: [
      'Las utilidades crecieron un 12% gracias a la eficiencia operacional.',
      'Las personas de las sucursales cerradas fueron reubicadas sin despidos.',
      'Invertiremos en atención digital para llegar a más regiones.',
    ],
    redLines: ['Prometer montos de inversión que no están aprobados.'],
    publics: ['Dirección'],
  },
  {
    key: 'medios',
    title: 'Presentación ante medios',
    category: 'MEDIOS',
    optic: 'Formal',
    context: 'El vocero debe anunciar ante la prensa la apertura de un nuevo centro de distribución que generará empleo local.',
    keyMessages: ['El centro generará 300 empleos directos en la comuna.', 'Priorizaremos la contratación de vecinos de la zona.'],
    redLines: ['Prometer plazos de apertura no confirmados.'],
    publics: ['Dirección', 'Planta'],
  },
  {
    key: 'politica',
    title: 'Cambio de política interna',
    category: 'INSTITUCIONAL',
    optic: 'Empática',
    context: 'La organización implementará un nuevo sistema de turnos rotativos en planta que ha generado inquietud entre los trabajadores.',
    keyMessages: [
      'El cambio busca reducir la carga de turnos nocturnos para todos.',
      'Ninguna persona verá reducido su sueldo con el nuevo sistema.',
      'Habrá un periodo de marcha blanca de dos meses con espacios de conversación.',
    ],
    redLines: ['Minimizar las preocupaciones de los trabajadores.'],
    publics: ['Planta', 'Técnicos'],
  },
  {
    key: 'tarifas',
    title: 'Alza de tarifas eléctricas',
    category: 'MEDIOS',
    optic: 'Técnica',
    context: 'La empresa anunció un alza de 8% en las tarifas residenciales a partir del próximo mes, en medio de críticas de asociaciones de consumidores.',
    keyMessages: [
      'El alza responde al costo de la energía fijado por la autoridad, no a mayores utilidades.',
      'Las familias vulnerables podrán acceder a un subsidio que cubre el alza.',
    ],
    redLines: ['Culpar al gobierno o a terceros sin evidencia.', 'Minimizar el impacto en el presupuesto de las familias.'],
    publics: ['Dirección'],
  },
];

// ------------------------------------------- Respuestas de ejemplo (siembra)

const lower = (s) => s.charAt(0).toLowerCase() + s.slice(1);

function composeAnswer(theme, i, level) {
  const km = theme.keyMessages;
  const m = km[i % km.length];
  if (level === 'low') {
    return [
      'Eh, bueno, este, estamos revisando la situación y todavía no tenemos todos los antecedentes.',
      'La verdad es que no fue tan grave como se ha dicho, este, la mayoría de los clientes ya tiene servicio.',
      'Eso hay que preguntárselo a los equipos técnicos, eh, yo no manejo ese detalle.',
      'Mire, en parte fue culpa del clima, eh, pero estamos trabajando.',
      'Eh, sí, vamos a ver qué se puede hacer.',
    ][i % 5];
  }
  if (level === 'mid') {
    // Sostiene algunos mensajes clave; en el resto responde de forma genérica
    const key = km[Math.floor(i / 3) % km.length];
    return [
      `Bueno, eh, lo que puedo decir es que ${lower(key)} Estamos trabajando en eso.`,
      'Entiendo la molestia, este, y estamos haciendo todo lo posible para resolverlo pronto.',
      'Es una pregunta válida. Eh, todavía estamos recopilando la información y seguiremos informando.',
      `Mire, ${lower(key)} Ese es el foco del equipo hoy.`,
      'Lo importante es que, este, estamos trabajando con todos los equipos en esto.',
    ][i % 5];
  }
  return [
    `Primero quiero decir que lamentamos profundamente lo que vivieron las personas afectadas y entiendo su molestia. ${m}`,
    `Asumimos nuestra responsabilidad. ${m} Y nos comprometemos a informar cada avance a las familias.`,
    `Comprendo la preocupación de los afectados, y por eso quiero ser claro: ${lower(m)}`,
    `No vamos a trasladar la responsabilidad a nadie: fue un error nuestro y lo reconocemos. ${m}`,
    `Lo más importante hoy son las personas. ${m} Vamos a revisar todo el proceso para que la respuesta sea más rápida.`,
  ][i % 5];
}

// Métricas medidas en el navegador (voz, cuerpo e iluminación), según el nivel
function composeMetrics(level, seed) {
  const r = (a, b) => a + ((seed * 9301 + 49297) % 233280) / 233280 * (b - a);
  const L = { low: 0, mid: 1, high: 2 }[level];
  const voice = {
    available: true,
    wpm: [188, 176, 170][L] + r(-6, 6),
    fillersPerMin: [6.8, 4.4, 3.1][L] + r(-0.4, 0.4),
    fillerWords: [['eh', 'este', 'o sea'], ['eh', 'este'], ['eh']][L],
    longPauses: [8, 6, 3][L],
    longPausesPerAnswer: [2.2, 1.5, 0.8][L],
    volumeVariation: [0.22, 0.31, 0.44][L] + r(-0.03, 0.03),
    avgLatencyMs: [3900, 3000, 2700][L] + r(-200, 200),
    speakingSeconds: [95, 160, 210][L],
    transcription: 'voz',
  };
  const body = {
    available: true,
    presence: [0.84, 0.92, 0.95][L],
    facingCamera: [0.48, 0.63, 0.71][L] + r(-0.03, 0.03),
    shoulderTilt: [7.5, 5.6, 4.6][L] + r(-0.5, 0.5),
    headMovement: [0.011, 0.0078, 0.0068][L],
    handActivity: [0.024, 0.017, 0.011][L],
  };
  return { voice, body, lighting: { average: [92, 118, 136][L] }, durationSeconds: [240, 300, 330][L] };
}

function composeTranscript(theme, level, questions = 5) {
  const history = [];
  const turns = [];
  const metrics = composeMetrics(level, theme.title.length);
  for (let i = 0; i < questions; i++) {
    const question = nextQuestion({ theme: { ...theme, keyMessages: JSON.stringify(theme.keyMessages), redLines: JSON.stringify(theme.redLines) }, history });
    const answer = composeAnswer(theme, i, level);
    history.push({ role: 'interviewer', text: question }, { role: 'vocero', text: answer });
    const words = answer.split(/\s+/).length;
    const fillers = (answer.match(/\b(eh|este)\b/gi) || []).length;
    turns.push({
      question,
      answer,
      metrics: {
        words,
        fillers,
        fillerWords: fillers ? ['eh', 'este'].filter((f) => answer.toLowerCase().includes(f)) : [],
        wpm: metrics.voice.wpm + ((i % 3) - 1) * 6,
        latencyMs: Math.round(metrics.voice.avgLatencyMs + ((i % 3) - 1) * 400),
        durationMs: Math.round((words / metrics.voice.wpm) * 60000) + 1500,
        speakingMs: Math.round((words / metrics.voice.wpm) * 60000),
        longPauses: Math.round(metrics.voice.longPausesPerAnswer + (i % 2) * 0.4),
        volumeVariation: metrics.voice.volumeVariation,
      },
    });
  }
  return { transcript: turns, metrics };
}

// ---------------------------------------------------------------- Siembra

function buildSeed() {
  const t1 = { id: '00000000-0000-0000-0000-000000000001', name: 'Empresa Demo', sector: 'Retail', status: 'ACTIVE', createdAt: daysAgo(120), retentionMode: 'FULL', retentionDays: 90 };
  const t2 = { id: '00000000-0000-0000-0000-000000000002', name: 'Energía Andes', sector: 'Energía', status: 'ACTIVE', createdAt: daysAgo(75), retentionMode: 'METRICS', retentionDays: 30, brandColor: '#0F3D35', accentColor: '#0F8A6A' };
  const t3 = { id: '00000000-0000-0000-0000-000000000003', name: 'Clínica Austral', sector: 'Salud', status: 'ACTIVE', createdAt: daysAgo(9), retentionMode: 'FULL', retentionDays: 180 };

  const user = (id, email, name, role, tenantId = null, extra = {}) => ({
    id,
    email,
    name,
    role,
    tenantId,
    area: null,
    status: 'ACTIVE',
    password: DEMO_PASSWORD,
    createdAt: daysAgo(60),
    lastLoginAt: daysAgo(1),
    ...extra,
  });

  const users = [
    user('u-sofia', 'sofia@voxready.io', 'Sofía Reyes', 'SYSTEM', null, { createdAt: daysAgo(150) }),
    user('u-marta', 'marta@voxready.io', 'Marta Vidal', 'MASTER', null, { createdAt: daysAgo(140) }),
    user('u-carlos', 'admin@demo.com', 'Carlos Ruiz', 'ADMIN', t1.id, { createdAt: daysAgo(118) }),
    user('u-ana', 'vocero@demo.com', 'Ana Torres', 'VOCERO', t1.id, { area: 'Dirección', createdAt: daysAgo(110), lastLoginAt: daysAgo(0) }),
    user('u-diego', 'diego@demo.com', 'Diego Paredes', 'VOCERO', t1.id, { area: 'Planta', createdAt: daysAgo(90), lastLoginAt: daysAgo(3) }),
    user('u-valentina', 'valentina@demo.com', 'Valentina Muñoz', 'VOCERO', t1.id, { area: 'Técnicos', createdAt: daysAgo(30), lastLoginAt: null }),
    user('u-lucia', 'lucia@andes.cl', 'Lucía Soto', 'ADMIN', t2.id, { createdAt: daysAgo(74) }),
    user('u-tomas', 'tomas@andes.cl', 'Tomás Rivas', 'VOCERO', t2.id, { area: 'Técnicos', createdAt: daysAgo(70), lastLoginAt: daysAgo(2) }),
    user('u-camila', 'camila@andes.cl', 'Camila Fuentes', 'VOCERO', t2.id, { area: 'Dirección', createdAt: daysAgo(50), lastLoginAt: daysAgo(5) }),
    user('u-pedro', 'pedro@andes.cl', 'Pedro Lagos', 'VOCERO', t2.id, { area: 'Planta', status: 'SUSPENDED', createdAt: daysAgo(48), lastLoginAt: daysAgo(40) }),
    user('u-rodrigo', 'rodrigo@austral.cl', 'Rodrigo Pérez', 'ADMIN', t3.id, { createdAt: daysAgo(9) }),
    user('u-ignacio', 'ignacio@austral.cl', 'Ignacio Vera', 'VOCERO', t3.id, { area: 'Dirección', createdAt: daysAgo(8), lastLoginAt: daysAgo(1) }),
  ];

  // Temas por organización
  const themes = [];
  const themeFor = (tenantId, key) => {
    const s = SCENARIOS.find((x) => x.key === key);
    const theme = {
      id: `th-${tenantId.slice(-1)}-${key}`,
      tenantId,
      title: s.title,
      context: s.context,
      category: s.category,
      optic: s.optic,
      keyMessages: JSON.stringify(s.keyMessages),
      redLines: JSON.stringify(s.redLines),
      publics: JSON.stringify(s.publics),
      availableToAllVoceros: Boolean(s.availableToAllVoceros),
      createdAt: daysAgo(100),
    };
    themes.push(theme);
    return theme;
  };
  ['integral', 'falla', 'seguridad', 'resultados', 'medios', 'politica'].forEach((k) => themeFor(t1.id, k));
  ['integral', 'tarifas', 'falla'].forEach((k) => themeFor(t2.id, k));
  ['seguridad', 'medios'].forEach((k) => themeFor(t3.id, k));
  const th = (tenant, key) => themes.find((t) => t.id === `th-${tenant.id.slice(-1)}-${key}`);

  const assignments = [];
  const assign = (userId, themeId) => assignments.push({ id: uid(), userId, themeId, status: 'PENDING', assignedAt: daysAgo(40) });
  ['integral', 'falla', 'seguridad', 'resultados'].forEach((k) => assign('u-ana', th(t1, k).id));
  ['integral', 'falla', 'seguridad', 'resultados', 'medios', 'politica'].forEach((k) => assign('u-diego', th(t1, k).id));
  ['integral', 'politica'].forEach((k) => assign('u-valentina', th(t1, k).id));
  ['integral', 'tarifas'].forEach((k) => assign('u-tomas', th(t2, k).id));
  ['integral', 'tarifas', 'falla'].forEach((k) => assign('u-camila', th(t2, k).id));
  ['seguridad', 'medios'].forEach((k) => assign('u-ignacio', th(t3, k).id));

  // Patrones de evaluación del configurador maestro
  const patterns = [
    { id: 'p-1', version: 1, name: 'Patrón base', status: 'INACTIVE', createdAt: daysAgo(130), createdById: 'u-marta', config: deepMerge(DEFAULT_CONFIG, { areas: { expression: 25, voice: 25, coherence: 25, empathy: 25 } }) },
    { id: 'p-2', version: 2, name: 'Estándar VoxReady 2026', status: 'ACTIVE', createdAt: daysAgo(45), createdById: 'u-marta', config: DEFAULT_CONFIG },
    {
      id: 'p-3',
      version: 3,
      name: 'Prioridad visual (dificultades del habla)',
      status: 'DRAFT',
      createdAt: daysAgo(12),
      createdById: 'u-marta',
      config: deepMerge(DEFAULT_CONFIG, { areas: { expression: 40, voice: 10, coherence: 30, empathy: 20 }, strictness: 'flexible' }),
    },
    {
      id: 'p-4',
      version: 4,
      name: 'Crisis de alta presión',
      status: 'DRAFT',
      createdAt: daysAgo(6),
      createdById: 'u-marta',
      config: deepMerge(DEFAULT_CONFIG, { areas: { expression: 20, voice: 20, coherence: 35, empathy: 25 }, strictness: 'exigente' }),
    },
  ];
  const patternOverrides = [{ themeId: th(t2, 'integral').id, patternId: 'p-4', createdAt: daysAgo(6) }];
  const voceroOverrides = [{ userId: 'u-camila', patternId: 'p-3', createdAt: daysAgo(12) }];

  // Biblioteca de escenarios generales de VoxReady: sin organización, visibles para todos los voceros
  LIBRARY_SCENARIOS.forEach((x, i) =>
    themes.push({
      id: `th-general-${i + 1}`,
      tenantId: null,
      isGlobal: true,
      title: x.title,
      context: x.context,
      category: x.category,
      optic: x.optic,
      keyMessages: JSON.stringify(x.keyMessages),
      redLines: JSON.stringify(x.redLines),
      publics: '[]',
      availableToAllVoceros: false,
      createdAt: daysAgo(120),
    }),
  );

  const db = { tenants: [t1, t2, t3], users, themes, assignments, sessions: [], patterns, patternOverrides, voceroOverrides, seededAt: new Date().toISOString() };

  // Prácticas evaluadas (historial con progreso)
  const practice = (userId, theme, level, d, review) => {
    const u = users.find((x) => x.id === userId);
    const s = SCENARIOS.find((x) => x.title === theme.title);
    const { transcript, metrics } = composeTranscript(s, level);
    const { pattern, source } = patternFor(db, theme.id, userId);
    const completedAt = daysAgo(d, 11 + (d % 6));
    const report = evaluateSession({ theme, transcript, metrics, pattern, patternSource: source, at: completedAt });
    const session = {
      id: uid(),
      status: 'COMPLETED',
      createdAt: completedAt,
      completedAt,
      userId,
      themeId: theme.id,
      tenantId: u.tenantId,
      transcript,
      metrics,
      report,
      score: report.global,
      review: null,
      hasVideo: false,
    };
    if (review) {
      const scores = Object.fromEntries(report.areas.map((a) => [a.key, a.score == null ? null : Math.max(0, Math.min(100, a.score + (review.delta?.[a.key] || 0)))]));
      session.review = {
        scores,
        comment: review.comment,
        reviewer: { id: 'u-marta', name: 'Marta Vidal' },
        at: daysAgo(d - 1),
        agreement: Object.fromEntries(report.areas.map((a) => [a.key, a.score != null && scores[a.key] != null ? Math.abs(a.score - scores[a.key]) : null])),
      };
    }
    db.sessions.push(session);
  };

  practice('u-ana', th(t1, 'falla'), 'low', 26);
  practice('u-ana', th(t1, 'seguridad'), 'low', 19, { comment: 'Coincido con la IA: la respuesta sobre el clima es una línea roja clara.', delta: { empathy: -4 } });
  practice('u-ana', th(t1, 'resultados'), 'mid', 12);
  practice('u-ana', th(t1, 'falla'), 'mid', 6, { comment: 'Buena evolución. La empatía está mejor de lo que marca la IA.', delta: { empathy: 9, voice: 2 } });
  practice('u-ana', th(t1, 'integral'), 'high', 2);
  practice('u-diego', th(t1, 'politica'), 'low', 15);
  practice('u-diego', th(t1, 'medios'), 'mid', 8);
  practice('u-diego', th(t1, 'integral'), 'mid', 1);
  practice('u-tomas', th(t2, 'tarifas'), 'mid', 10);
  practice('u-tomas', th(t2, 'integral'), 'high', 4, { comment: 'Muy buen manejo de la presión.', delta: { coherence: -3 } });
  practice('u-camila', th(t2, 'integral'), 'low', 3);
  practice('u-ignacio', th(t3, 'seguridad'), 'mid', 1);

  return db;
}

// Patrón aplicable, por prioridad: el del vocero, el del escenario o el activo
export function patternFor(db, themeId, userId) {
  const byVocero = db.voceroOverrides.find((o) => o.userId === userId);
  if (byVocero) return { pattern: db.patterns.find((p) => p.id === byVocero.patternId), source: 'vocero' };
  const byTheme = db.patternOverrides.find((o) => o.themeId === themeId);
  if (byTheme) return { pattern: db.patterns.find((p) => p.id === byTheme.patternId), source: 'scenario' };
  const active = [...db.patterns].filter((p) => p.status === 'ACTIVE').sort((a, b) => b.version - a.version)[0];
  return { pattern: active || null, source: 'active' };
}

// ------------------------------------------------------------ Persistencia

let cache = null;

export function getDb() {
  if (cache) return cache;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) cache = JSON.parse(stored);
  } catch {
    cache = null;
  }
  if (!cache) {
    cache = buildSeed();
    saveDb();
  }
  return cache;
}

export function saveDb() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch {
    /* sin almacenamiento: la demo funciona en memoria */
  }
}

export function resetDb() {
  cache = buildSeed();
  saveDb();
}
