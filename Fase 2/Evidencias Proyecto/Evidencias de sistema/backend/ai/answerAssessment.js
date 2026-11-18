// Evaluacion adaptativa de la respuesta del vocero: reglas deterministas + IA + validacion.
//
// Reglas de oro:
//  - Las reglas solo deciden casos evidentes (vacia, muletillas, desconocimiento, negativa,
//    repeticion). Nunca declaran "suficiente": la suficiencia la decide la IA (o la contingencia).
//  - La salida de la IA es estructurada y se valida: JSON estricto, estados cerrados, `focus`
//    obligatorio cuando no es suficiente y `evidence` que debe ser texto LITERAL del vocero.
//  - Si toda la cadena falla, se devuelve `unevaluable`: no se interpreta como suficiente.

const STATUS = ['sufficient', 'partial', 'evasive', 'contradiction'];
const RULE_STATUS = ['empty', 'unknown', 'refusal', 'repeat', 'no_transcript'];

const FILLERS = /^(eh+|em+|este+|esto+|bueno|ok|okay|ya|mmm+|ah+|claro|obvio)+$/i;
// Muletillas en inglés ("um", "well", "you know"…). Solo se aplican a respuestas en inglés.
const FILLERS_EN = /^(um+|uh+|erm+|hmm+|mm+|well|like|so|yeah|right|okay|ok)+$/i;
const UNKNOWN =
  /(no lo s[eé]|no s[eé]|no tengo (esa|esta|mayor|otra) informaci[oó]n|no manejo (ese|este) dato|tendr[ií]a que (revisarlo|verlo|confirmarlo)|no puedo confirmarlo|no estoy seguro)/i;
const REFUSAL =
  /(sin comentarios|no voy a (responder|comentar|referirme)|no puedo (hablar|comentar|referirme)|no me voy a referir|prefiero no (responder|comentar))/i;
const UNKNOWN_EN =
  /(i (do ?n[o']t|don't) know|i have no information|i (do ?n[o']t|don't) have that information|i can't confirm (that|it)|i cannot confirm (that|it)|i'?m not sure|i would have to (check|review|confirm) (it|that))/i;
const REFUSAL_EN =
  /(no comment|i'?m not going to (answer|comment|respond)|i (can'?t|cannot) (talk|comment|answer) about|i won'?t comment|i'?d rather not (answer|comment))/i;

const normalize = (text) => String(text ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

// Respuesta compuesta solo por muletillas ("eh, este, bueno"): se evalua palabra por palabra.
// El patrón depende del idioma de la respuesta (español o inglés).
function isFillerOnly(text, pattern = FILLERS) {
  const tokens = text.replace(/[.,!?;:¡¿"']/g, ' ').split(/\s+/).filter(Boolean);
  return tokens.length > 0 && tokens.every((token) => pattern.test(token));
}

// Reglas deterministas: devuelven { status, reason } o null (se delega a la IA).
// `spoke` (se detectó voz en la respuesta) y `hasTranscript` distinguen un SILENCIO real de una
// transcripción que no se pudo obtener: sin texto, si el vocero habló, NO es silencio ni
// respuesta suficiente, y no se inventa lo que dijo.
// `lang` selecciona los patrones del idioma de la respuesta (los estados son los mismos).
function ruleDecision({ answer, previousAnswers = [], spoke = false, hasTranscript = null, lang = 'es' } = {}) {
  const text = normalize(answer);
  const english = lang === 'en';
  const fillers = english ? FILLERS_EN : FILLERS;
  const unknown = english ? UNKNOWN_EN : UNKNOWN;
  const refusal = english ? REFUSAL_EN : REFUSAL;
  if (!text) {
    if (spoke === true && hasTranscript !== true) return { status: 'no_transcript', reason: 'transcripcion_no_disponible' };
    return { status: 'empty', reason: 'respuesta_vacia' };
  }
  if (isFillerOnly(text, fillers)) return { status: 'empty', reason: 'solo_muletillas' };
  if (text.length <= 200 && unknown.test(text)) return { status: 'unknown', reason: 'desconocimiento_declarado' };
  if (text.length <= 200 && refusal.test(text)) return { status: 'refusal', reason: 'negativa_explicita' };
  if (previousAnswers.some((prev) => normalize(prev) === text)) return { status: 'repeat', reason: 'respuesta_repetida' };
  return null;
}

// Instrucciones del clasificador en cada idioma. El contrato JSON (claves y valores de `status`)
// es EXACTAMENTE el mismo en ambos idiomas: solo cambia el idioma de las instrucciones.
const ASSESSMENT_TEXTS = {
  es: {
    analyst: 'Eres un analista de entrevistas. Decides si la ULTIMA respuesta del vocero contesta de verdad la pregunta principal.',
    noInvent: 'No inventes hechos, cifras, citas ni contradicciones. Usa solo lo que aparece en la transcripcion.',
    brief: 'Una respuesta BREVE puede ser suficiente si contesta lo que se pregunto.',
    noExtra: 'No exijas detalles que la pregunta no pidio y no repitas una cuestion ya resuelta antes en la conversacion.',
    aggressiveness: (value) => `Agresividad configurada: ${value}.`,
    followUps: (used, extraordinary, total) =>
      `Repreguntas habituales usadas en esta pregunta principal: ${used}. Extraordinarias: ${extraordinary} de ${total}.`,
    jsonOnly: 'Responde SOLO con un objeto JSON valido, sin markdown ni texto adicional, con esta forma exacta:',
    contradiction:
      'Usa "contradiction" solo si el vocero se contradice con una declaracion ANTERIOR suya y cita los fragmentos en "evidence".',
    sufficient: 'Usa "sufficient" si lo solicitado ya esta respondido, aunque falten detalles que nadie pidio.',
    // A4: como rellenar los campos que NO son el estado. Aclara el contrato; no cambia estados,
    // evidencias, deteccion de contradicciones ni la logica de repreguntas.
    focusRule:
      'El campo "focus" describe la INFORMACION CONCRETA que sigue pendiente de la respuesta (dato, cifra, plazo, causa, responsable, medida, compromiso o alcance), redactado como aspecto por aclarar. No describas en "focus" la conducta del vocero ni diagnostiques que evadio, que no entendio o que no respondio: ese diagnostico va en "reason". Si el estado es "sufficient", "focus" queda vacio.',
    extraordinaryRule:
      'El campo "justify_extraordinary" se pone en true SOLO si la respuesta no es suficiente, queda un punto pendiente concreto y una repregunta adicional aportaria una aclaracion sustantiva que el presupuesto habitual no cubre; ademas, su efecto depende de que la linea de extraordinarias muestre margen disponible. Se deja en false por defecto: no lo uses para insistir sin un punto pendiente concreto, no lo uses cuando el estado es "sufficient" y no lo uses como sustituto del estado "contradiction" (una contradiccion se marca en "status" con sus citas).',
    interviewer: 'ENTREVISTADOR',
    respondent: 'VOCERO',
    mainQuestion: (question) => `PREGUNTA PRINCIPAL ACTUAL: ${question}`,
    transcript: (turns) => `TRANSCRIPCION RECIENTE:\n${turns}`,
    noTurns: 'TRANSCRIPCION RECIENTE: (sin turnos previos)',
    lastAnswer: (answer) => `ULTIMA RESPUESTA DEL VOCERO: ${answer}`,
    evaluate: 'Evalua esa ultima respuesta y devuelve el JSON.',
  },
  en: {
    analyst: 'You are an interview analyst. You decide whether the spokesperson LAST answer truly addresses the main question.',
    noInvent: 'Do not invent facts, figures, quotes or contradictions. Use only what appears in the transcript.',
    brief: 'A BRIEF answer can be sufficient if it addresses what was asked.',
    noExtra: 'Do not demand details the question did not ask for and do not repeat a point already settled earlier in the conversation.',
    aggressiveness: (value) => `Configured aggressiveness: ${value}.`,
    followUps: (used, extraordinary, total) =>
      `Standard follow-ups used on this main question: ${used}. Extraordinary: ${extraordinary} of ${total}.`,
    jsonOnly: 'Reply ONLY with a valid JSON object, without markdown or additional text, using exactly this shape:',
    contradiction:
      'Use "contradiction" only if the spokesperson contradicts an EARLIER statement of their own and quote the fragments in "evidence".',
    sufficient: 'Use "sufficient" if what was asked is already answered, even if details nobody requested are missing.',
    // A4: how to fill the fields that are NOT the status (contract clarification only).
    focusRule:
      'The "focus" field describes the CONCRETE information still missing from the answer (figure, date, cause, owner, measure, commitment or scope), written as the point to clarify. Do not describe the spokesperson behaviour in "focus" and do not diagnose that they evaded, misunderstood or did not answer: that diagnosis belongs in "reason". When the status is "sufficient", "focus" stays empty.',
    extraordinaryRule:
      'Set "justify_extraordinary" to true ONLY if the answer is not sufficient, a concrete point remains pending, and one extra follow-up would add a substantive clarification that the standard budget does not cover; its effect also depends on the extraordinary line showing room left. It stays false by default: do not use it to insist without a concrete pending point, do not use it when the status is "sufficient", and do not use it as a substitute for the "contradiction" status (a contradiction is reported in "status" with its quotes).',
    interviewer: 'INTERVIEWER',
    respondent: 'SPOKESPERSON',
    mainQuestion: (question) => `CURRENT MAIN QUESTION: ${question}`,
    transcript: (turns) => `RECENT TRANSCRIPT:\n${turns}`,
    noTurns: 'RECENT TRANSCRIPT: (no previous turns)',
    lastAnswer: (answer) => `SPOKESPERSON LAST ANSWER: ${answer}`,
    evaluate: 'Assess that last answer and return the JSON.',
  },
};

const assessmentTexts = (lang) => ASSESSMENT_TEXTS[lang] || ASSESSMENT_TEXTS.es;

function buildMessages({ mainQuestion, answer, history = [], cfg, followUpsUsed = 0, extraordinaryUsed = 0, budget = {}, lang = 'es' }) {
  const T = assessmentTexts(lang);
  const turns = history
    .slice(-12)
    .map((turn) => `${turn.role === 'interviewer' ? T.interviewer : T.respondent}: ${String(turn.text || '').slice(0, 600)}`)
    .join('\n');
  const system = [
    T.analyst,
    T.noInvent,
    T.brief,
    T.noExtra,
    T.aggressiveness(cfg?.aggressiveness || 'MEDIA'),
    T.followUps(followUpsUsed, extraordinaryUsed, budget.extraordinary ?? 0),
    T.jsonOnly,
    '{"status":"sufficient|partial|evasive|contradiction","focus":"informacion pendiente (vacio si sufficient)","evidence":["fragmento literal del vocero"],"justify_extraordinary":false,"reason":"motivo breve"}',
    T.contradiction,
    T.sufficient,
    // A4: guia de los campos que acompanan al estado. Se anade al final del prompt para no alterar
    // el orden de las instrucciones existentes ni el contrato JSON.
    T.focusRule,
    T.extraordinaryRule,
  ].join('\n');
  const user = [
    T.mainQuestion(String(mainQuestion || '').slice(0, 600)),
    turns ? T.transcript(turns) : T.noTurns,
    T.lastAnswer(String(answer || '').slice(0, 1200)),
    T.evaluate,
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

// Motivo representativo de un conjunto de fallos. Con la seleccion "el primero valido que llega",
// los fallos terminan en CUALQUIER orden, asi que el motivo se calcula por FRECUENCIA (y, en
// empate, por un orden fijo de prioridad) para que no dependa de una carrera entre modelos.
// Solo usa el vocabulario que ya existia: timeout, error_proveedor y formato_invalido.
const FAILURE_PRIORITY = ['timeout', 'error_proveedor', 'formato_invalido'];

function summarizeFailure(failures = []) {
  const counts = new Map();
  for (const failure of failures) counts.set(failure, (counts.get(failure) || 0) + 1);
  let best = null;
  let bestCount = 0;
  for (const kind of FAILURE_PRIORITY) {
    const count = counts.get(kind) || 0;
    if (count > bestCount) {
      best = kind;
      bestCount = count;
    }
  }
  return best || failures[0] || 'sin_respuesta';
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
  lang = 'es',
  models = [],
  askModel = null,
  timeoutMs = 15000,
  now = () => Date.now(),
} = {}) {
  const startedAt = now();
  const rule = ruleDecision({ answer, previousAnswers, spoke, hasTranscript, lang });
  if (rule) return { ...rule, source: `rule:${rule.status}`, ms: now() - startedAt, evidence: [], focus: '' };

  if (typeof askModel !== 'function' || !models.length) {
    return { status: 'unevaluable', source: 'no-models', reason: 'sin_modelos_de_evaluacion', ms: now() - startedAt, evidence: [], focus: '' };
  }

  const messages = buildMessages({ mainQuestion, answer, history, cfg, followUpsUsed, extraordinaryUsed, budget, lang });
  let lastFailure = 'sin_respuesta';
  // Motivos de fallo observados, en cualquier orden de llegada. Se resumen al final con
  // `summarizeFailure`, que no depende del orden: el motivo no puede ser producto de una carrera.
  const failures = [];
  try {
    // Cada modelo compite por su cuenta: cuando llega su respuesta se valida de inmediato y, si
    // supera TODAS las validaciones, gana la carrera. Gana el PRIMER resultado VALIDO que llegue
    // (no el primero de la lista) y en ese momento se deja de esperar al resto. Un resultado rapido
    // pero invalido NO gana: se descarta y los demas siguen compitiendo. Las solicitudes perdedoras
    // NO se cancelan: siguen ejecutandose y su resultado se ignora.
    const attempts = models.map((model) =>
      Promise.resolve()
        .then(() => askModel(model, messages, { timeoutMs }))
        .then((raw) => {
          const valid = parseAssessment(typeof raw === 'string' ? raw : raw?.text ?? raw?.content, { answer, history });
          if (valid) return { ...valid, source: `ai:${model}`, ms: now() - startedAt };
          const rejected = new Error('respuesta descartada: no supera la validacion');
          rejected.failure = 'formato_invalido';
          throw rejected;
        })
        .catch((error) => {
          // Motivo del fallo: el modelo respondio pero no cumple el contrato (formato_invalido) o no
          // respondio (error_proveedor / timeout). Se registra y se propaga para dejarlo fuera de la
          // competencia; los demas modelos siguen compitiendo.
          failures.push(error?.failure || (error?.name === 'AbortError' ? 'timeout' : 'error_proveedor'));
          throw error;
        }),
    );
    attempts.forEach((attempt) => attempt.catch(() => {}));
    // `Promise.any`: resuelve con el PRIMER resultado que cumpla el contrato y solo rechaza si TODOS
    // fallan (AggregateError), que es exactamente el caso "ningun modelo entrego un resultado valido".
    return await Promise.any(attempts);
  } catch (error) {
    const everyModelFailed = error?.name === 'AggregateError' || Array.isArray(error?.errors);
    lastFailure =
      everyModelFailed && failures.length
        ? summarizeFailure(failures)
        : error?.name === 'AbortError'
          ? 'timeout'
          : 'error_inesperado';
  }
  return { status: 'unevaluable', source: 'ai-failed', reason: lastFailure, ms: now() - startedAt, evidence: [], focus: '' };
}

module.exports = { assessAnswer, ruleDecision, parseAssessment, validateAssessment, buildMessages, STATUS, RULE_STATUS };

