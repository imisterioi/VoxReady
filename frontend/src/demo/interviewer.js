// Entrevistador del modo demostración. En producción las preguntas las genera la IA
// (backend/ai/interviewer.js); aquí se arman a partir del escenario con plantillas:
// abre con los hechos, repregunta si el vocero evade, tienta a cruzar las líneas
// rojas y avanza hacia otros aspectos de la crisis.
import { parseList } from './patternConfig';
import { normalizeInterviewConfig } from './interviewConfig';

const OPENERS = {
  CRISIS: [
    () => 'Buenas tardes. ¿Qué ocurrió exactamente y por qué las personas afectadas se enteraron primero por redes sociales?',
    () => '¿Cuántas personas se vieron afectadas y qué está haciendo hoy su organización por ellas?',
  ],
  MEDIOS: [
    () => 'Gracias por recibirnos. Para partir, ¿cuál es el mensaje principal que quiere entregar hoy?',
    () => '¿Qué datos concretos respaldan lo que nos está diciendo?',
  ],
  INSTITUCIONAL: [
    () => '¿Por qué la organización decidió hacer este cambio ahora y a quién afecta directamente?',
    () => '¿Cómo va a explicar este cambio a quienes no estaban de acuerdo?',
  ],
  GENERAL: [
    () => 'Cuéntenos, ¿qué está pasando y cómo afecta a las personas?',
    () => '¿Qué medidas concretas están tomando y en qué plazo?',
  ],
};

const PRESSURE = [
  '¿Por qué tardaron tanto en dar la cara? Hubo horas sin ninguna información oficial.',
  '¿Quién es el responsable de lo que pasó? ¿Va a rodar alguna cabeza?',
  'Hay personas que dicen que esto se pudo evitar. ¿Qué les responde?',
  '¿Qué garantías tienen los afectados de que esto no se va a repetir?',
  '¿Van a compensar a las personas afectadas? ¿Cuándo y de qué forma?',
  'Usted habla de medidas, pero ¿qué cambió realmente desde ayer?',
  'Si usted fuera uno de los afectados, ¿estaría conforme con esta respuesta?',
];

// Preguntas que tientan al vocero a cruzar cada línea roja
function temptationFor(line) {
  const l = line.toLowerCase();
  if (/culp|terceros|clima/.test(l)) return '¿No será que la responsabilidad es de otros? Hay quienes apuntan al clima o a los propios usuarios.';
  if (/minimiz|grave/.test(l)) return 'Seamos honestos: ¿fue realmente tan grave como se dice en redes, o se está exagerando?';
  if (/promet|plazo|monto/.test(l)) return '¿Me puede garantizar hoy, en cámara, una fecha y un monto exacto para las compensaciones?';
  return `Hay quienes dicen que usted terminará diciendo algo como: "${line}". ¿Qué tiene que decir al respecto?`;
}

const pick = (list, seed) => list[Math.abs(seed) % list.length];

// Una frase de la última respuesta del vocero (la más larga), recortada para citarla
function quoteFrom(answer) {
  const sentences = answer.split(/[.!?]+/).map((s) => s.trim()).filter((s) => s.split(/\s+/).length >= 4);
  const longest = sentences.sort((a, b) => b.length - a.length)[0] || answer.trim();
  const words = longest.split(/\s+/).slice(0, 16).join(' ');
  return words.charAt(0).toLowerCase() + words.slice(1);
}

// Repregunta sobre la última respuesta, según el nivel de agresividad del escenario
const FOLLOW_UPS = {
  BAJA: [
    (q) => `Para que quede claro a quienes nos escuchan: cuando dice que "${q}", ¿a qué se refiere exactamente?`,
    () => '¿Podría profundizar un poco más en lo que acaba de explicar?',
  ],
  MEDIA: [
    (q) => `Usted dice que "${q}", pero eso no responde lo que le pregunté. ¿Puede ser más preciso?`,
    (q) => `¿Qué respaldo concreto tiene para afirmar que "${q}"?`,
  ],
  ALTA: [
    (q) => `Usted afirma que "${q}". ¿Quién responde por eso, con nombre y cargo?`,
    (q) => `Eso de que "${q}" no calza con lo que cuentan los afectados. ¿Quién está diciendo la verdad?`,
  ],
  EXTREMA: [
    (q) => `¿Dice entonces que "${q}" y que con eso las personas afectadas deberían quedar conformes?`,
    (q) => `¿Está reconociendo que "${q}" es todo lo que su organización tiene para ofrecer?`,
  ],
};

// plan: qué toca en este turno (pregunta nueva o repregunta) según la configuración del escenario
export function nextQuestion({ theme, history = [], plan = null }) {
  const t = theme || { title: 'la crisis que enfrenta su empresa', category: 'CRISIS' };
  const asked = history.filter((h) => h.role === 'interviewer').map((h) => h.text);
  const lastAnswer = [...history].reverse().find((h) => h.role === 'vocero')?.text?.trim() || '';
  const turn = asked.length;
  const openers = OPENERS[t.category] || OPENERS.GENERAL;
  const level = normalizeInterviewConfig(t.interviewConfig).aggressiveness;

  // 1) Apertura
  if (turn === 0) return openers[0](t);

  // 2) Si no respondió o fue muy breve, repregunta de forma más directa
  if (lastAnswer.split(/\s+/).filter(Boolean).length < 6) {
    return `No respondió a mi pregunta. Se lo planteo de forma directa: ${asked[asked.length - 1].replace(/^.*?¿/, '¿')}`;
  }

  // 3) Turno de repregunta: toma una frase de la respuesta y la cuestiona
  if (plan?.kind === 'followup') return pick(FOLLOW_UPS[level], turn)(quoteFrom(lastAnswer));

  // 4) Cada cierto turno, tentar a cruzar una línea roja (con presión baja no se tienta)
  const redLines = level === 'BAJA' ? [] : parseList(t.redLines);
  if (redLines.length && turn % 2 === 0) {
    const candidate = temptationFor(redLines[(turn / 2 - 1) % redLines.length]);
    if (!asked.includes(candidate)) return candidate;
  }

  // 5) Preguntas de presión que aún no se han hecho
  const pool = [openers[1](t), ...PRESSURE].filter((q) => !asked.includes(q));
  return pick(pool.length ? pool : PRESSURE, turn * 7 + lastAnswer.length);
}
