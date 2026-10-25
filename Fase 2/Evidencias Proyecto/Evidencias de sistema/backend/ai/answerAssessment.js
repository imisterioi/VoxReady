// Evaluacion adaptativa de la respuesta del vocero: reglas deterministas + IA + validacion.
//
// Reglas de oro:
//  - Las reglas SOLO deciden casos evidentes (vacia, muletillas, desconocimiento, negativa,
//    repeticion). Nunca declaran "suficiente": la suficiencia la decide la IA (o la contingencia).
//  - La salida de la IA es estructurada y se VALIDA: JSON estricto, estados cerrados, `focus`
//    obligatorio cuando no es suficiente y `evidence` que debe ser texto LITERAL del vocero.
//  - Si toda la cadena falla, se devuelve `unevaluable`: NUNCA se interpreta como suficiente.

const STATUS = ['sufficient', 'partial', 'evasive', 'contradiction'];
const RULE_STATUS = ['empty', 'unknown', 'refusal', 'repeat', 'no_transcript'];

const FILLERS = /^(eh+|em+|este+|esto+|bueno|ok|okay|ya|mmm+|ah+|claro|obvio)+$/i;
const UNKNOWN =
  /(no lo s[eé]|no s[eé]|no tengo (esa|esta|mayor|otra) informaci[oó]n|no manejo (ese|este) dato|tendr[ií]a que (revisarlo|verlo|confirmarlo)|no puedo confirmarlo|no estoy seguro)/i;
const REFUSAL =
  /(sin comentarios|no voy a (responder|comentar|referirme)|no puedo (hablar|comentar|referirme)|no me voy a referir|prefiero no (responder|comentar))/i;

const normalize = (text) => String(text ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

// Respuesta compuesta SOLO por muletillas ("eh, este, bueno"): se evalua palabra por palabra.
function isFillerOnly(text) {
  const tokens = text.replace(/[.,!?;:¡¿"']/g, ' ').split(/\s+/).filter(Boolean);
  return tokens.length > 0 && tokens.every((token) => FILLERS.test(token));
}

// Reglas deterministas: devuelven { status, reason } o null (se delega a la IA).
// `spoke` (se detectó voz en la respuesta) y `hasTranscript` distinguen un SILENCIO real de una
// transcripción que no se pudo obtener: sin texto, si el vocero habló, NO es silencio ni
// respuesta suficiente, y nunca se inventa lo que dijo.
function ruleDecision({ answer, previousAnswers = [], spoke = false, hasTranscript = null } = {}) {
  const text = normalize(answer);
  if (!text) {
    if (spoke === true && hasTranscript !== true) return { status: 'no_transcript', reason: 'transcripcion_no_disponible' };
    return { status: 'empty', reason: 'respuesta_vacia' };
  }
  if (isFillerOnly(text)) return { status: 'empty', reason: 'solo_muletillas' };
  if (text.length <= 200 && UNKNOWN.test(text)) return { status: 'unknown', reason: 'desconocimiento_declarado' };
  if (text.length <= 200 && REFUSAL.test(text)) return { status: 'refusal', reason: 'negativa_explicita' };
  if (previousAnswers.some((prev) => normalize(prev) === text)) return { status: 'repeat', reason: 'respuesta_repetida' };
  return null;
}

function buildMessages({ mainQuestion, answer, history = [], cfg, followUpsUsed = 0, extraordinaryUsed = 0, budget = {} }) {
  const turns = history
    .slice(-12)
    .map((turn) => `${turn.role === 'interviewer' ? 'ENTREVISTADOR' : 'VOCERO'}: ${String(turn.text || '').slice(0, 600)}`)
    .join('\n');
  const system = [
    'Eres un analista de entrevistas. Decides si la ULTIMA respuesta del vocero contesta de verdad la pregunta principal.',
    'No inventes hechos, cifras, citas ni contradicciones. Usa solo lo que aparece en la transcripcion.',
    'Una respuesta BREVE puede ser suficiente si contesta lo que se pregunto.',
    'No exijas detalles que la pregunta no pidio y no repitas una cuestion ya resuelta antes en la conversacion.',
    `Agresividad configurada: ${cfg?.aggressiveness || 'MEDIA'}.`,
    `Repreguntas habituales usadas en esta pregunta principal: ${followUpsUsed}. Extraordinarias: ${extraordinaryUsed} de ${budget.extraordinary ?? 0}.`,
    'Responde SOLO con un objeto JSON valido, sin markdown ni texto adicional, con esta forma exacta:',
    '{"status":"sufficient|partial|evasive|contradiction","focus":"informacion pendiente (vacio si sufficient)","evidence":["fragmento literal del vocero"],"justify_extraordinary":false,"reason":"motivo breve"}',
    'Usa "contradiction" solo si el vocero se contradice con una declaracion ANTERIOR suya y cita los fragmentos en "evidence".',
    'Usa "sufficient" si lo solicitado ya esta respondido, aunque falten detalles que nadie pidio.',
  ].join('\n');
  const user = [
    `PREGUNTA PRINCIPAL ACTUAL: ${String(mainQuestion || '').slice(0, 600)}`,
    turns ? `TRANSCRIPCION RECIENTE:\n${turns}` : 'TRANSCRIPCION RECIENTE: (sin turnos previos)',
    `ULTIMA RESPUESTA DEL VOCERO: ${String(answer || '').slice(0, 1200)}`,
    'Evalua esa ultima respuesta y devuelve el JSON.',
  ].join('\n\n');
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

// Extrae y valida el JSON del modelo. Devuelve null si no es utilizable.
function parseAssessment(raw, { answer = '', history = [] } = {}) {
  const text = String(raw ?? '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let parsed;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  return validateAssessment(parsed, { answer, history });
}

function validateAssessment(parsed, { answer = '', history = [] } = {}) {
  const status = String(parsed?.status ?? '').trim().toLowerCase();
  if (!STATUS.includes(status)) return null;
  const focus = String(parsed?.focus ?? '').trim().slice(0, 300);
  if (status !== 'sufficient' && !focus) return null;
  const rawEvidence = Array.isArray(parsed?.evidence) ? parsed.evidence : [];
  const corpus = [answer, ...history.filter((turn) => turn.role !== 'interviewer').map((turn) => turn.text)].map(normalize);
  const evidence = rawEvidence
    .map((item) => String(item ?? '').trim())
    .filter((quote) => quote.length >= 8)
    .filter((quote) => corpus.some((source) => source.includes(normalize(quote))))
    .slice(0, 3);
  const base = {
    status,
    focus,
    evidence,
    reason: String(parsed?.reason ?? '').trim().slice(0, 200),
    justifyExtraordinary: parsed?.justify_extraordinary === true,
  };
  // Una contradiccion sin DOS citas verificables no se trata como hecho: queda como parcial.
  if (status === 'contradiction' && evidence.length < 2) {
    return { ...base, status: 'partial', reason: base.reason || 'contradiccion_sin_evidencia_verificable' };
  }
  return base;
}

async function assessAnswer({
  mainQuestion = '',
  answer = '',
  history = [],
  previousAnswers = [],
  spoke = false,
  hasTranscript = null,
  cfg = {},
  followUpsUsed = 0,
  extraordinaryUsed = 0,
  budget = {},
  models = [],
  askModel = null,
  timeoutMs = 15000,
  now = () => Date.now(),
} = {}) {
  const startedAt = now();
  const rule = ruleDecision({ answer, previousAnswers, spoke, hasTranscript });
  if (rule) return { ...rule, source: `rule:${rule.status}`, ms: now() - startedAt, evidence: [], focus: '' };

  if (typeof askModel !== 'function' || !models.length) {
    return { status: 'unevaluable', source: 'no-models', reason: 'sin_modelos_de_evaluacion', ms: now() - startedAt, evidence: [], focus: '' };
  }

  const messages = buildMessages({ mainQuestion, answer, history, cfg, followUpsUsed, extraordinaryUsed, budget });
  let lastFailure = 'sin_respuesta';
  try {
    // Se consultan todos en paralelo; gana el PRIMER resultado VALIDO segun el orden de la cadena
    // (un resultado rapido pero invalido no gana). Los perdedores no se cancelan.
    const attempts = models.map((model) =>
      Promise.resolve()
        .then(() => askModel(model, messages, { timeoutMs }))
        .then((raw) => ({ ok: true, model, raw: typeof raw === 'string' ? raw : raw?.text ?? raw?.content }))
        .catch((error) => ({ ok: false, model, error })),
    );
    attempts.forEach((attempt) => attempt.catch(() => {}));
    const results = await Promise.all(attempts);
    for (const item of results) {
      if (!item.ok) {
        lastFailure = item.error?.name === 'AbortError' ? 'timeout' : 'error_proveedor';
        continue;
      }
      const valid = parseAssessment(item.raw, { answer, history });
      if (valid) return { ...valid, source: `ai:${item.model}`, ms: now() - startedAt };
      lastFailure = 'formato_invalido';
    }
  } catch (error) {
    lastFailure = error?.name === 'AbortError' ? 'timeout' : 'error_inesperado';
  }
  return { status: 'unevaluable', source: 'ai-failed', reason: lastFailure, ms: now() - startedAt, evidence: [], focus: '' };
}

module.exports = { assessAnswer, ruleDecision, parseAssessment, validateAssessment, buildMessages, STATUS, RULE_STATUS };

