// Entrevistador IA: genera la siguiente pregunta usando la API de NVIDIA
// (compatible con OpenAI). Configuración en backend/.env.local:
//   NVIDIA_API_KEY=nvapi-...
//   AI_MODEL=deepseek-ai/deepseek-v4.1-flash          (modelo principal)
//   AI_FALLBACK_MODEL=google/gemma-4-31b-it           (respaldo si el principal no responde)
//   AI_TIMEOUT_MS=20000                               (espera máxima por modelo)
//   AI_EXTRA_MODELS=moonshotai/kimi-k3,nvidia/nemotron-3-super-120b-a12b  (más respaldos)
//
// En el plan gratuito la disponibilidad de cada modelo cambia minuto a minuto,
// por eso se consultan varios a la vez y se usa el primero que responda.

const { AGGRESSIVENESS, normalizeInterviewConfig, turnPlan } = require('./interviewConfig');
const { recordAi } = require('../lib/runtimeStatus');

const BASE_URL = 'https://integrate.api.nvidia.com/v1';

const DEFAULT_MODEL = 'deepseek-ai/deepseek-v4.1-flash';
const DEFAULT_FALLBACK = 'google/gemma-4-31b-it';
const DEFAULT_EXTRA = 'z-ai/glm-5.3-flash,nvidia/nemotron-3.5-lightning-30b-a3b';

// Longitud de la pregunta. `QUESTION_TARGET_WORDS` es el objetivo que se pide al modelo y
// `MAX_QUESTION_WORDS` es el tope REAL que aplica `cleanQuestion`: una sola fuente de verdad
// para que la instrucción del prompt y la validación digan exactamente lo mismo.
const QUESTION_TARGET_WORDS = 35;
const MAX_QUESTION_WORDS = 70;


// Los temas guardan listas como texto JSON (editor de temas) o como texto plano (seed antiguo)
function parseList(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
  } catch {
    /* texto plano */
  }
  return [String(value)];
}
// Tono y estructura del entrevistador en inglés (equivalente a AGGRESSIVENESS, que está en español).
// Comportamiento del entrevistador en inglés (equivalente a AGGRESSIVENESS, que está en español).
const AGGRESSIVENESS_EN = {
  BAJA: {
    persona: 'Your tone is warm and collaborative: you give the spokesperson room to explain and you neither interrupt nor accuse them.',
    followUp: 'Politely ask them to clarify or expand on what they just said.',
    approach: 'You are supportive: your priority is that the spokesperson can explain themselves comfortably and that the public understands the essentials.',
    formulate: 'Open, clear questions (what happened, who was affected, what will you do), one idea per question, no jargon.',
    press: 'You only ask a simple clarification when the answer cannot be understood. You do not systematically demand figures, deadlines or owners.',
    evasion: 'If the answer is vague, you give ONE second chance with a more concrete question and accept whatever they answer.',
    contradiction: 'If two different versions appear, you ask which one is correct, in a neutral tone and without accusing.',
    advance: 'You consider the answer sufficient when the essentials are clear, even if details nobody asked for are missing.',
  },
  MEDIA: {
    persona: 'You are incisive but respectful: you do not accept generic answers and you ask for specifics.',
    followUp: 'Follow up on what the spokesperson avoided answering or left unclear in their last response.',
    approach: 'Professional and direct: you look for concrete facts and you do not let a generality pass as an answer.',
    formulate: 'Concrete, narrow questions (how many, since when, which measure, by when), built on what the spokesperson already said.',
    press: 'You ask for precision when a detail that matters to the public is missing: scope, cause, deadlines or owners.',
    evasion: 'If they evade, you follow up once, neutrally naming what was left unanswered.',
    contradiction: 'If there are different versions, you ask them to clarify, quoting what they said and explaining how the two differ.',
    advance: 'You move on when what you asked is answered, even if secondary details remain open.',
  },
  ALTA: {
    persona: 'You are direct and incisive: you ask for verifiable explanations and you confront inconsistencies when they are supported by what was actually said, with no hostility, no assumptions and never treating as certain any fact the spokesperson did not state.',
    followUp: 'Ask for a verifiable explanation of what does not add up, quoting the spokesperson own words.',
    approach: 'Incisive: you question evasions and demand verifiable explanations, always without hostility.',
    formulate: 'Demanding, specific questions built on the spokesperson own words about what does not add up or is incomplete.',
    press: 'You demand figures, owners and deadlines when the issue is critical; if they do not exist, you ask why.',
    evasion: 'You do not accept generalities: you name which question was left unanswered and reformulate it more precisely.',
    contradiction: 'You address the inconsistency head-on: you quote both versions and ask which one is correct and why the other was said.',
    advance: 'You move on when you get the fact or explanation you asked for; if the answer is still evasive, you exhaust your follow-up budget and continue.',
  },
  EXTREMA: {
    persona: 'You are very demanding on critical issues: you ask for unequivocal answers and you confront directly when there is enough evidence, with no hostility, no baseless accusations and never assuming anything the spokesperson did not state.',
    followUp: 'Ask for an unequivocal answer on the critical point, quoting what the spokesperson actually said.',
    approach: 'Very incisive and demanding on the critical issues: you ask the hard questions and require direct answers, with no insults, no baseless accusations and nothing invented.',
    formulate: 'Direct, high-precision questions about what is critical (people affected, risk, money, responsibility), one per turn.',
    press: 'You insist on the critical points until you get a clear answer and you explicitly name what remains unanswered.',
    evasion: 'When they evade, you show it with the quote of what they said and ask the most concrete, answerable version of the question.',
    contradiction: 'You address the contradiction head-on: you lay out both versions and ask for a direct answer on which one is true.',
    advance: 'You move on when the answer is direct and verifiable; if it is not, you close the point noting that it was left unanswered.',
  },
};

// Nivel de agresividad por idioma (la tabla en español vive en interviewConfig).
const LEVELS = { es: AGGRESSIVENESS, en: AGGRESSIVENESS_EN };

// Textos fijos del entrevistador en español. El contenido del escenario (título, contexto,
// mensajes clave y líneas rojas) proviene de la base de datos y se inserta tal cual.
const TEXTS_ES = {
  interviewerFallback: 'un periodista chileno',
  opening: (who) => `Eres ${who} y entrevistas en vivo al vocero de una organización.`,
  scenario: (title) => `Escenario: ${title}.`,
  context: (text) => `Contexto: ${text}`,
  keyMessages: (list) => `Mensajes que el vocero intentará sostener: ${list.join(' | ')}`,
  redLines: (list) => `Cosas que el vocero NO debe decir (líneas rojas): ${list.join(' | ')}`,
  scenarioDefault: 'Escenario: una empresa enfrenta una crisis que afecta a sus clientes.',
  rulesHeader: 'Reglas:',
  // La longitud se declara con el objetivo de producto (35) y con el tope REAL del validador
  // (`MAX_QUESTION_WORDS`): así la instrucción y `cleanQuestion` dicen lo mismo.
  oneQuestion: (target, cap) => `- Haz UNA sola pregunta, en español, de máximo ${target} palabras (si supera ${cap}, se descarta).`,
  silentLow: '- El vocero se quedó en silencio. Señálalo con amabilidad, sin afirmar por qué ocurrió, e invítalo a contestar la pregunta anterior.',
  silentHigh: '- El vocero se quedó en SILENCIO y no respondió. Háblale de usted, señala sin interpretar que no hubo respuesta, pregunta qué deben entender las personas afectadas y vuelve a plantear la pregunta anterior.',
  followUpTurn: '- Este turno es una REPREGUNTA sobre la última respuesta del vocero.',
  newQuestion: '- Este turno es una pregunta NUEVA: aborda un aspecto de la situación que todavía no se haya tratado.',
  noAnswerInsist: '- Si el vocero no dijo nada, insiste en la pregunta anterior de forma más directa.',
  evasive: '- Si el vocero evade o responde de forma genérica, repregunta sobre el punto concreto que quedó sin responder.',
  mainInProgress: (question) => `- Pregunta principal en curso: "${question}"`,
  pendingFocus: (focus) => `- Aspecto pendiente que debe aclarar: ${focus}`,
  // B3: el foco del clasificador se declara como REQUISITO del turno (no como orientacion suelta).
  // Se anaden dos lineas y no se reestructura el resto del prompt.
  followUpFocusRule:
    '- PRIORIDAD DE ESTE TURNO: la repregunta debe solicitar EXACTAMENTE el aspecto pendiente que se indica abajo. No cambies a otro tema aunque la pregunta principal plantease varias cosas, no repitas la pregunta principal y mantén el idioma y el tono de la entrevista.',
  followUpFocusFallback:
    '- Si ese aspecto no permite formular una pregunta pertinente, mantén la coherencia con la conversación y no inventes información.',
  noTranscript: '- No hay transcripción utilizable de su última respuesta: pide una aclaración concreta sobre el punto central, sin afirmar lo que dijo.',
  noRepeat: '- No repitas preguntas que ya hiciste.',
  onlyQuestion:
    '- Responde solo con la pregunta, en una sola línea: sin saludos, viñetas, comillas, explicaciones ni etiquetas. Puedes empezar esa misma línea con un conector muy breve ("Entiendo,", "De acuerdo,") si ayuda a la conversación; nunca lo pongas en otra línea. Si escribes varias líneas, se usará solo la que contenga la pregunta.',
  // Bloque de IDIOMA: se declara en cada solicitud (el idioma de la sesión manda, pase lo que pase).
  languageHeader: 'Idioma de la entrevista (obligatorio, no negociable):',
  languageRules: [
    '- Formula TODAS tus preguntas y repreguntas en español.',
    '- Aunque el vocero responda en otro idioma, sigue preguntando en español.',
    '- Aunque el escenario incluya palabras o expresiones en otro idioma, no cambies de idioma.',
    '- No traduzcas nombres propios, marcas, cargos ni nombres de instituciones: escríbelos tal como aparecen.',
    '- No inventes traducciones de nombres institucionales ni alteres los mensajes clave.',
  ],
  spokeNoText: '(habló, pero no se pudo transcribir su respuesta)',
  silence: '(silencio, no respondió)',
  answerPrefix: (text) => `Respuesta del vocero: ${text}`,
  startInterview: 'Comienza la entrevista con tu primera pregunta.',

  // ---- Etapa 1: bloques nuevos (objetivo, método, comportamiento, prohibiciones, contexto y memoria) ----
  objectiveHeader: 'Objetivo de la entrevista:',
  objective:
    'Que el público entienda con claridad qué ocurrió, a quién afectó, por qué ocurrió, quién responde, qué se está haciendo y qué compromisos existen. Consíguelo con preguntas naturales: esto no es una lista de temas.',
  methodHeader: 'Método:',
  methodSteps: [
    '- Una sola idea por intervención; avanza en la comprensión (qué ocurrió → a quién afectó → causa → responsables → medidas → compromisos y plazos → pendientes), adaptándote a lo que el vocero responda.',
    '- Apóyate en lo que el vocero ya dijo: pide precisión sobre sus propias palabras, cifras y promesas.',
    '- No repitas el enfoque de una pregunta anterior, aunque cambies las palabras.',
    '- Si la última respuesta ya contesta lo que preguntaste, no insistas: avanza a lo que falta.',
  ],
  behaviorHeader: 'Comportamiento de tu nivel:',
  levelLines: {
    tone: 'Tono',
    approach: 'Enfoque',
    formulate: 'Cómo preguntar',
    press: 'Qué exiges',
    evasion: 'Ante una evasiva',
    contradiction: 'Ante una contradicción',
    advance: 'Cuándo avanzar',
  },
  prohibitedHeader: 'Prohibido en todos los niveles:',
  prohibitions: [
    '- No inventes hechos, cifras, declaraciones, acusaciones ni antecedentes.',
    '- No insultes ni uses hostilidad gratuita.',
    '- No induzcas al vocero a revelar información confidencial.',
    '- No busques que cruce sus líneas rojas.',
    '- No repitas una pregunta solo para aumentar la presión.',
    '- No presentes suposiciones como hechos comprobados.',
  ],
  org: (name, sector) => `Organización: ${name}${sector ? ` (sector: ${sector})` : ''}.`,
  optic: (value) => `Óptica institucional esperada: ${value}`,
  publics: (list) => `Público al que se dirige el vocero: ${list.join(' | ')}`,
  memoryHeader: 'Memoria de la entrevista:',
  memoryTurn: (turn, total, main, mains) => `- Vas por el turno ${turn} de ${total} (pregunta principal ${main} de ${mains}).`,
  memoryMains: (list) => `- Preguntas principales ya hechas: ${list.join(' / ')}`,
  memoryTopics: (list) => `- Temas preguntados (una pregunta NO implica que esté respondido): ${list.join(', ')}.`,
  memoryAnswered: (list) => `- Temas respondidos según el análisis: ${list.join(', ')}.`,
  memoryNeeds: (list) => `- Temas pendientes de aclaración: ${list.join(', ')}.`,
  memoryPending: (list) => `- Temas aún no preguntados (orientación, no obligación): ${list.join(', ')}.`,
  memoryFacts: (label, list) => `- ${label} ya mencionados por el vocero: ${list.join('; ')}`,
  memoryTension: (text) => `- Posible inconsistencia: ${text}`,
  memoryNotAnswered:
    '- Un tema preguntado NO está respondido: si un tema no aparece entre los respondidos, insiste con una pregunta concreta; si aparece una posible inconsistencia, pide que la aclare antes de darla por cierta.',
  memoryAdvice:
    '- Usa la memoria solo para dar continuidad y pedir precisión sobre lo ya dicho; no des por hecho nada que el vocero no haya dicho.',
  assessment: (status) => `- El análisis de la última respuesta la clasificó como "${status}": actúa según tu nivel.`,
  factsLabels: { figures: 'Datos y cifras', dates: 'Fechas y plazos', commitments: 'Compromisos', actors: 'Responsables u organismos' },
};

// Textos fijos del entrevistador en inglés (equivalente a TEXTS_ES).
const TEXTS_EN = {
  interviewerFallback: 'a Chilean journalist',
  opening: (who) => `You are ${who} and you are interviewing the spokesperson of an organization live.`,
  scenario: (title) => `Scenario: ${title}.`,
  context: (text) => `Context: ${text}`,
  keyMessages: (list) => `Messages the spokesperson will try to uphold: ${list.join(' | ')}`,
  redLines: (list) => `Things the spokesperson must NOT say (red lines): ${list.join(' | ')}`,
  scenarioDefault: 'Scenario: a company faces a crisis that affects its customers.',
  rulesHeader: 'Rules:',
  oneQuestion: (target, cap) => `- Ask ONE single question, in English, of at most ${target} words (anything above ${cap} is discarded).`,
  silentLow: '- The spokesperson stayed silent. Kindly point it out, without asserting why, and invite them to answer the previous question.',
  silentHigh: '- The spokesperson stayed SILENT and did not answer. Address them formally, state without interpreting that there was no answer, ask what the affected people should understand and pose the previous question again.',
  followUpTurn: '- This turn is a FOLLOW-UP on the spokesperson last answer.',
  newQuestion: '- This turn is a NEW question: cover an aspect of the situation that has not been addressed yet.',
  noAnswerInsist: '- If the spokesperson said nothing, press the previous question more directly.',
  evasive: '- If the spokesperson evades or answers generically, follow up on the concrete point that was left unanswered.',
  mainInProgress: (question) => `- Main question in progress: "${question}"`,
  pendingFocus: (focus) => `- Pending point they must clarify: ${focus}`,
  // B3: the classifier focus is stated as a REQUIREMENT of the turn (not loose guidance).
  followUpFocusRule:
    '- PRIORITY FOR THIS TURN: the follow-up must ask about EXACTLY the pending point stated below. Do not switch to another topic even if the main question raised several things, do not repeat the main question, and keep the language and tone of the interview.',
  followUpFocusFallback:
    '- If that point does not allow a relevant question, stay consistent with the conversation and do not invent information.',
  noTranscript: '- There is no usable transcript of their last answer: ask for a concrete clarification on the central point, without asserting what they said.',
  noRepeat: '- Do not repeat questions you already asked.',
  onlyQuestion:
    '- Reply only with the question, on a single line: no greetings, bullets, quotes, explanations or labels. You may start that same line with a very short connector ("I see,", "Right,") if it helps the conversation flow; never put it on a separate line. If you write several lines, only the one containing the question will be used.',
  // Language block: stated in EVERY request (the session language wins, no matter what).
  languageHeader: 'Interview language (mandatory, non-negotiable):',
  languageRules: [
    '- Ask ALL your questions and follow-ups in English.',
    '- Even if the spokesperson answers in another language, keep asking in English.',
    '- Even if the scenario includes words or expressions in another language, do not switch language.',
    '- Do not translate proper nouns, brands, job titles or institution names: write them exactly as they appear.',
    '- Do not invent translations of institutional names and do not alter the key messages.',
  ],
  spokeNoText: '(they spoke, but their answer could not be transcribed)',
  silence: '(silence, no answer)',
  answerPrefix: (text) => `Spokesperson answer: ${text}`,
  startInterview: 'Start the interview with your first question.',

  // ---- Stage 1: new blocks (objective, method, behaviour, prohibitions, context and memory) ----
  objectiveHeader: 'Interview objective:',
  objective:
    'That the public clearly understands what happened, who was affected, why it happened, who is accountable, what is being done and what commitments exist. Achieve it with natural questions: this is not a checklist.',
  methodHeader: 'Method:',
  methodSteps: [
    '- One idea per turn; advance the understanding (what happened → who was affected → cause → accountability → measures → commitments and deadlines → pending items), adapting to what the spokesperson answers.',
    '- Build on what the spokesperson already said: ask for precision about their own words, figures and promises.',
    '- Do not repeat the angle of a previous question, even with different wording.',
    '- If the last answer already addresses what you asked, do not insist: move on to what is missing.',
  ],
  behaviorHeader: 'Behaviour for your level:',
  levelLines: {
    tone: 'Tone',
    approach: 'Approach',
    formulate: 'How to ask',
    press: 'What you demand',
    evasion: 'When they evade',
    contradiction: 'When they contradict themselves',
    advance: 'When to move on',
  },
  prohibitedHeader: 'Forbidden at every level:',
  prohibitions: [
    '- Do not invent facts, figures, statements, accusations or background.',
    '- Do not insult or use gratuitous hostility.',
    '- Do not lead the spokesperson into revealing confidential information.',
    '- Do not try to make them cross their red lines.',
    '- Do not repeat a question just to increase pressure.',
    '- Do not present assumptions as established facts.',
  ],
  org: (name, sector) => `Organization: ${name}${sector ? ` (sector: ${sector})` : ''}.`,
  optic: (value) => `Expected institutional stance: ${value}`,
  publics: (list) => `Audience the spokesperson is addressing: ${list.join(' | ')}`,
  memoryHeader: 'Interview memory:',
  memoryTurn: (turn, total, main, mains) => `- You are on turn ${turn} of ${total} (main question ${main} of ${mains}).`,
  memoryMains: (list) => `- Main questions already asked: ${list.join(' / ')}`,
  memoryTopics: (list) => `- Topics asked (a question does NOT mean it was answered): ${list.join(', ')}.`,
  memoryAnswered: (list) => `- Topics answered according to the analysis: ${list.join(', ')}.`,
  memoryNeeds: (list) => `- Topics pending clarification: ${list.join(', ')}.`,
  memoryPending: (list) => `- Topics not yet asked (guidance, not mandatory): ${list.join(', ')}.`,
  memoryFacts: (label, list) => `- ${label} already mentioned by the spokesperson: ${list.join('; ')}`,
  memoryTension: (text) => `- Possible inconsistency: ${text}`,
  memoryNotAnswered:
    '- A topic that was asked is NOT answered: if a topic does not appear among the answered ones, insist with a concrete question; if a possible inconsistency appears, ask them to clarify it before treating it as certain.',
  memoryAdvice:
    '- Use this memory only to keep continuity and ask for precision about what was already said; never treat as a fact anything the spokesperson did not say.',
  assessment: (status) => `- The analysis of the last answer classified it as "${status}": act according to your level.`,
  factsLabels: { figures: 'Facts and figures', dates: 'Dates and deadlines', commitments: 'Commitments', actors: 'Accountable parties' },
};

// Textos por idioma (por defecto, español).
const TEXTS = { es: TEXTS_ES, en: TEXTS_EN };
const textsFor = (lang) => TEXTS[lang] || TEXTS.es;



// ------------------------------------------------------------ memoria de la entrevista
// Resumen determinista construido SOLO con datos que ya viajan en la solicitud (el historial del
// navegador, el estado por turno que ya calculó el clasificador y la configuración del escenario).
// No consulta la base de datos, no llama a ningún modelo y se calcula una vez por pregunta.
//
// Para qué: que el entrevistador no dependa solo de los últimos diez turnos ni confunda "ya lo
// pregunté" con "ya me lo respondió". El bloque de memoria separa temas preguntados, respondidos
// y pendientes de aclaración, resume los datos ya dichos y avisa de posibles inconsistencias; el
// historial completo sigue enviándose en los mensajes, acotado a los turnos recientes.

// Escalera de progresión (orientativa, no obligatoria): cada paso se detecta por palabras clave
// en las preguntas ya formuladas. No inventa contenido: solo clasifica lo ya preguntado.
const TOPIC_LADDER = [
  { key: 'hecho', es: 'qué ocurrió', en: 'what happened', re: /(qu[eé]\s+(?:ocurri|pas|suced|fall|est[aá]\s+pasando)|c[oó]mo\s+(?:ocurri|pas)|what\s+happened|what\s+occurred|what\s+went\s+wrong)/i },
  { key: 'afectados', es: 'a quiénes afectó y con qué alcance', en: 'who was affected and how widely', re: /(a\s+qui[eé]nes?\s+|cu[aá]nt(?:os|as)\s+|alcance|afectad|perjudicad|v[ií]ctimas|damnificad|hogares|pacientes|who\s+was\s+affected|how\s+many|affected|impact)/i },
  { key: 'causa', es: 'la causa o el origen', en: 'the cause or origin', re: /(por\s+qu[eé]|causa|origen|motivo|falla|what\s+caused|why\s+did|cause|origin)/i },
  { key: 'responsables', es: 'quién responde o autorizó', en: 'who is accountable', re: /(responsab|qui[eé]n\s+(?:autoriz|decidi|tom[oó]|aprob|estaba)|culpa|responsible|who\s+(?:authoriz|decid|approved))/i },
  { key: 'medidas', es: 'qué medidas se tomaron', en: 'what measures were taken', re: /(medidas|protocolo|plan\s+de|contingencia|qu[eé]\s+(?:har[aá]n|est[aá]n\s+haciendo)|measures|protocol|what\s+are\s+you\s+doing)/i },
  { key: 'compromisos', es: 'compromisos y plazos', en: 'commitments and deadlines', re: /(compromis|compens|plazo|para\s+cu[aá]ndo|garant|promet|indemniz|commitment|deadline|when\s+will|compensation)/i },
  { key: 'pendientes', es: 'qué queda pendiente', en: 'what remains pending', re: /(pendiente|qu[eé]\s+falta|pr[oó]ximos\s+pasos|seguimiento|pending|next\s+steps|what\s+remains)/i },
];

const clipText = (value, max) => {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

// Coincidencias únicas y acotadas: evita repetir datos y evita inflar el prompt.
function collectMatches(text, pattern, max) {
  const found = [];
  for (const match of String(text || '').matchAll(pattern)) {
    const value = clipText(match[0], 80);
    if (!value) continue;
    if (found.some((item) => item.toLowerCase() === value.toLowerCase())) continue;
    found.push(value);
    if (found.length >= max) break;
  }
  return found;
}

// Datos/cifras, fechas, compromisos y responsables: solo lo que dijo el vocero (nunca lo que
// plantea el escenario) y sin interpretar nada.
const FIGURES_RE = /(\d[\d.,]*\s*(?:%|por ciento|clientes|usuarios|personas|hogares|familias|pacientes|trabajadores|viviendas|pesos|d[oó]lares|millones|mil|horas?|minutos?|segundos?|d[ií]as?|semanas?|meses?|a[nñ]os?)|(?:el|un)\s+100\s*%)/gi;
const DATES_RE = /\b(hoy|ayer|ma[nñ]ana|esta (?:semana|ma[nñ]ana|tarde|noche)|la pr[oó]xima semana|el (?:lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)|en \d+ (?:horas?|d[ií]as?|semanas?|meses?)|el \d{1,2} de (?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)|today|yesterday|tomorrow|next week|in \d+ (?:hours?|days?|weeks?|months?))\b/gi;
const COMMITMENTS_RE = /((?:nos )?compromet\w+|compens(?:aremos|ará|arán)|vamos a \w+|garantiz(?:amos|aremos)|informar(?:emos|á|án)|publicar(?:emos|á|án)|restablec(?:eremos|erá|erán)|entregar(?:emos|á|án)|revisar(?:emos|á|án)|indemniz\w+|we will \w+|we are going to \w+|we commit\w+|we'll \w+)/gi;
const ACTORS_RE = /((?:el|la|los|las|del|de la)\s+(?:gerente|director|directora|jefe|jefa|presidente|presidenta|superintendencia|ministro|ministra|comit[eé]|subestaci[oó]n|hospital|cl[ií]nica|banco|empresa|fiscal[ií]a|municipalidad|gobierno|seremi)(?:\s+(?:de|del)\s+[\wáéíóúñ]+){0,2}(?:\s+[A-ZÁÉÍÓÚÑ][\wáéíóúñ]+)*)/gi;

// Temas PREGUNTADOS: qué pasos de la escalera aparecen en las preguntas ya formuladas. Marca lo
// que se preguntó, nunca lo que se respondió (para eso está el estado del clasificador).
function detectTopics(questions = []) {
  const asked = [];
  for (const step of TOPIC_LADDER) {
    if (questions.some((question) => step.re.test(String(question || '')))) asked.push(step.key);
  }
  return asked;
}

// Referente de una cifra: las palabras que la acompañan. "80.000 clientes afectados" no es lo
// mismo que "4.200 clientes sin suministro", aunque compartan la palabra "clientes".
//
// Detección CONSERVADORA, local y determinista (sin sinónimos, sin interpretación semántica y sin
// llamadas a modelos): solo se compara cuando los referentes son equivalentes; si son distintos o
// ambiguos NO se señala nada. La nota es siempre "posible": nunca una acusación ni un hecho.
const REFERENT_STOPWORDS = new Set([
  'de','del','la','las','los','el','en','con','sin','a','al','por','para','que','y','e','o','u',
  'un','una','unos','unas','se','su','sus','es','son','era','eran','fue','fueron','ha','han','hay',
  'the','of','and','to','in','on','with','at','that','were','was','is','are','for','from','by',
]);

// Marcadores de momento ("todavía", "hasta ahora"): no forman parte del referente, pero sí del
// contexto de la cifra, así que se informan en la nota en vez de descartarse.
const REFERENT_MOMENT_RE = /(todav[ií]a|actualmente|ahora|en este momento|por ahora|hasta ahora|al d[ií]a de hoy|still|so far|currently|right now)/i;

// Cifra + hasta 3 palabras de contexto: "80.000 clientes afectados", "4.200 clientes sin suministro".
const FIGURE_REF_RE = /(\d[\d.,]*)\s+([\p{L}][\p{L}\d-]*(?:\s+[\p{L}][\p{L}\d-]*){0,3})/gu;

// Palabras con contenido de un referente: normalizadas (sin tildes ni signos) y sin vacías.
function referentWords(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((word) => word && !REFERENT_STOPWORDS.has(word) && !REFERENT_MOMENT_RE.test(word));
}

// ¿Dos menciones hablan del mismo referente? Solo si una secuencia está contenida al inicio de la
// otra (o son idénticas). Con una sola palabra la mención es ambigua y NO se compara: preferimos
// no señalar nada antes que señalar algo falso.
function sameReferent(a = [], b = []) {
  const short = a.length <= b.length ? a : b;
  const long = a.length <= b.length ? b : a;
  if (!short.length) return false;
  if (short.length === long.length) return short.join(' ') === long.join(' ');
  if (short.length < 2) return false;
  return short.every((word, index) => word === long[index]);
}

// Inconsistencia POTENCIAL entre cifras de RESPUESTAS DISTINTAS que comparten referente. Devuelve
// los hechos (no la redacción) para poder avisar en el idioma de la entrevista; `null` cuando no
// hay evidencia suficiente. Nunca afirma que el vocero mintió ni que la contradicción sea un hecho.
function detectTension(answers = []) {
  if (!Array.isArray(answers) || answers.length < 2) return null;
  const found = [];
  answers.forEach((answer, index) => {
    const text = String(answer || '');
    for (const match of text.matchAll(FIGURE_REF_RE)) {
      const words = referentWords(match[2]);
      if (!words.length) continue;
      const before = text.slice(Math.max(0, (match.index || 0) - 40), match.index || 0);
      const moment = REFERENT_MOMENT_RE.test(match[2])
        ? match[2].match(REFERENT_MOMENT_RE)[1]
        : REFERENT_MOMENT_RE.test(before)
          ? before.match(REFERENT_MOMENT_RE)[1]
          : null;
      found.push({
        answer: index,
        value: match[1],
        words,
        label: clipText(String(match[2]).replace(/\s+/g, ' ').trim(), 40),
        moment,
      });
    }
  });
  for (let i = 0; i < found.length; i += 1) {
    for (let j = i + 1; j < found.length; j += 1) {
      const a = found[i];
      const b = found[j];
      if (a.answer === b.answer) continue; // solo se comparan respuestas distintas
      if (a.value === b.value) continue; // la misma cifra no es una inconsistencia
      if (!sameReferent(a.words, b.words)) continue; // referente distinto o ambiguo: no se señala
      return {
        referent: a.label || b.label,
        values: [a.value, b.value].slice(0, 3),
        moments: [...new Set([a.moment, b.moment].filter(Boolean))].slice(0, 2),
      };
    }
  }
  return null;
}

// Redacción de la nota: "posible", acotada y con la advertencia de que pueden ser cosas distintas.
function tensionNote(facts, lang = 'es') {
  if (!facts) return null;
  const values = facts.values.join(' y ');
  const moment = facts.moments.length
    ? lang === 'en'
      ? ` One mention refers to a specific moment ("${facts.moments.join('", "')}").`
      : ` Una mención corresponde a un momento concreto ("${facts.moments.join('", "')}").`
    : '';
  return lang === 'en'
    ? `two different figures for "${facts.referent}": ${values}. They may refer to different things: ask them to clarify before treating it as a contradiction.${moment}`
    : `dos cifras distintas sobre «${facts.referent}»: ${values}. Pueden referirse a cosas diferentes: pide que lo aclare antes de darlo por contradictorio.${moment}`;
}

// Estados de un tema de la escalera. El estado proviene del clasificador EXISTENTE (no se
// modifica): aquí solo se lee su resultado por turno.
//  - 'asked'              → se preguntó. Una pregunta NO implica una respuesta.
//  - 'answered'           → respuesta suficiente Y la pregunta abordaba ese único tema.
//  - 'needsClarification' → la respuesta quedó parcial, evasiva, contradictoria o sin contenido.
//  - 'notAsked'           → todavía no se preguntó (orientación, no obligación).
const NEEDS_CLARIFICATION_STATUS = new Set([
  'partial','evasive','contradiction','empty','unknown','refusal','repeat','no_transcript',
]);

// Resoluciones del clasificador, una por turno y sin duplicados: un reintento de la misma
// solicitud no debe desalinear el emparejamiento pregunta → respuesta → resolución.
function uniqueResolutions(resolutions = []) {
  const out = [];
  for (const item of Array.isArray(resolutions) ? resolutions : []) {
    if (!item || item.turn == null) continue;
    if (out.some((seen) => Number(seen.turn) === Number(item.turn))) continue;
    out.push(item);
  }
  return out;
}

// Empareja cada pregunta del historial con la respuesta que le sigue y con la resolución que la
// evaluó. La correspondencia NO se asume por índice: manda el número de turno y, solo si el
// historial y las resoluciones están alineados (misma cantidad de respuestas evaluadas), se usa
// además el orden cronológico. Sin información fiable, la pregunta queda sin estado.
function pairResolutions(pairs = [], resolutions = []) {
  const list = uniqueResolutions(resolutions);
  const answered = pairs.filter((pair) => pair.answer !== null);
  const alignedByOrder = list.length > 0 && list.length === answered.length;
  answered.forEach((pair, index) => {
    const byTurn = list.find((item) => Number(item.turn) === Number(pair.turn)) || null;
    pair.resolution = byTurn || (alignedByOrder ? list[index] : null) || null;
  });
  return pairs;
}

// Preguntas del historial con su respuesta (aunque venga vacía: eso es silencio o transcripción
// fallida, nunca una respuesta suficiente) y su tipo real (principal / repregunta).
function pairHistory(history = [], cfg = null) {
  const pairs = [];
  let interviewerIndex = 0;
  let current = null;
  for (const turn of Array.isArray(history) ? history : []) {
    const text = clipText(turn?.text, 2000);
    if (turn?.role === 'interviewer') {
      if (!text) continue;
      const kind = cfg ? turnPlan(cfg, interviewerIndex).kind : 'main';
      interviewerIndex += 1;
      current = { text, kind, turn: interviewerIndex, answer: null, resolution: null };
      pairs.push(current);
      continue;
    }
    if (current && current.answer === null) current.answer = text || '';
  }
  return pairs;
}

// Resumen estructurado de la entrevista hasta este turno.
// `resolutions` es el estado por turno que ya calcula el clasificador (lo aporta la sesión): es lo
// que permite distinguir un tema preguntado de uno respondido. Sin `resolutions` (por ejemplo,
// tras reiniciar el backend) los temas quedan solo como preguntados, nunca como respondidos.
function buildMemory({ history = [], cfg = null, plan = null, lang = 'es', resolutions = [] } = {}) {
  const pairs = pairResolutions(pairHistory(history, cfg), resolutions);
  const answers = [];
  for (const turn of Array.isArray(history) ? history : []) {
    if (turn?.role === 'interviewer') continue;
    const text = clipText(turn?.text, 2000);
    if (text) answers.push(text);
  }

  const askedKeys = new Set();
  const answeredKeys = new Set();
  const needsKeys = new Set();
  for (const pair of pairs) {
    const keys = detectTopics([pair.text]);
    for (const key of keys) askedKeys.add(key);
    const status = pair.resolution?.status ? String(pair.resolution.status) : null;
    if (!status) continue; // sin dato del clasificador: el tema queda solo como preguntado
    if (status === 'sufficient') {
      // Una pregunta puede abordar varios aspectos: la respuesta suficiente solo se atribuye al
      // tema cuando la pregunta trataba UN único tema de la escalera.
      if (keys.length === 1) answeredKeys.add(keys[0]);
      continue;
    }
    if (NEEDS_CLARIFICATION_STATUS.has(status)) for (const key of keys) needsKeys.add(key);
  }

  const label = (key) => {
    const step = TOPIC_LADDER.find((item) => item.key === key);
    return lang === 'en' ? step.en : step.es;
  };
  const ladderList = (keys, limit = 4) =>
    TOPIC_LADDER.filter((step) => keys.has(step.key)).map((step) => label(step.key)).slice(0, limit);
  const joined = answers.join('\n');
  return {
    turn: plan?.number ?? null,
    total: plan?.total ?? null,
    mainNumber: plan?.mainNumber ?? null,
    mainsTotal: cfg?.questionCount ?? null,
    mains: pairs.filter((item) => item.kind === 'main').map((item) => clipText(item.text, 90)).slice(-6),
    asked: ladderList(askedKeys, TOPIC_LADDER.length),
    answered: ladderList(answeredKeys),
    needsClarification: ladderList(needsKeys),
    notAsked: TOPIC_LADDER.filter((step) => !askedKeys.has(step.key)).map((step) => label(step.key)).slice(0, 4),
    figures: collectMatches(joined, FIGURES_RE, 5),
    dates: collectMatches(joined, DATES_RE, 4),
    commitments: collectMatches(joined, COMMITMENTS_RE, 4),
    actors: collectMatches(joined, ACTORS_RE, 4),
    tension: tensionNote(detectTension(answers), lang),
  };
}

// Preguntas que quedaron RESPONDIDAS de forma suficiente (con su tema), para no volver a pedirlas.
// Solo se usan temas con estado `sufficient`: nunca parciales, evasivos ni sin estado.
function answeredQuestions({ asked = [], resolutions = [] } = {}) {
  const out = [];
  const list = uniqueResolutions(resolutions).filter((item) => String(item.status) === 'sufficient');
  for (const resolution of list) {
    const question = asked.find((item) => Number(item.turn) === Number(resolution.turn));
    if (!question?.question) continue;
    const topics = detectTopics([question.question]);
    // Igual que en la memoria: la respuesta suficiente solo se atribuye a un tema cuando la
    // pregunta abordaba UN único tema de la escalera.
    if (topics.length === 1) out.push({ text: question.question, topics });
  }
  return out;
}

// Proporción de las palabras de `candidate` que ya estaban en `base` (relativa a la más corta).
function overlapRatio(base, candidate) {
  const known = new Set(referentWords(base));
  const words = referentWords(candidate);
  if (!known.size || !words.length) return 0;
  return words.filter((word) => known.has(word)).length / Math.min(known.size, words.length);
}

// ¿Una pregunta reservada ya quedó obsoleta? Solo cuando pide un tema que YA fue respondido de
// forma suficiente y, además, su enunciado repite en gran medida la pregunta respondida. No se
// descarta una profundización legítima ni una pregunta que comparte una categoría general: hacen
// falta tema `sufficient` + solapamiento alto (0,6).
function isReservedQuestionStale(item, { asked = [], resolutions = [] } = {}) {
  if (String(item?.kind || 'normal') === 'followup') return false;
  const question = String(item?.question || '').trim();
  if (!question) return false;
  const topics = detectTopics([question]);
  if (!topics.length) return false;
  return answeredQuestions({ asked, resolutions }).some(
    (entry) => entry.topics.some((key) => topics.includes(key)) && overlapRatio(entry.text, question) >= 0.6,
  );
}

// Instrucciones del entrevistador. El bloque estable (rol, objetivo, método, comportamiento del
// nivel, prohibiciones e idioma) es común a todos los escenarios; el bloque dinámico aporta el
// escenario, la organización y la memoria de la conversación.
// `turn` describe el turno real que se está pidiendo: { kind, mainQuestion, focus, hasTranscript,
// assessmentStatus }. `silent`: el vocero no dijo nada (silencio real, no transcripción fallida).
// `lang`: idioma efectivo del vocero ('es' | 'en'). `extras`: { memory, tenant, assessment }.
function buildSystemPrompt(theme, cfg, plan, turn = {}, silent = false, lang = 'es', extras = {}) {
  const T = textsFor(lang);
  const level = (LEVELS[lang] || LEVELS.es)[cfg.aggressiveness];
  const who = cfg.interviewerRole || T.interviewerFallback;
  const memory = extras.memory || null;
  const tenant = extras.tenant || theme?.tenant || null;
  const assessment = extras.assessment || null;
  const L = T.levelLines;
  const lines = [T.opening(who)];

  // --- Bloque estable: qué debe lograr la entrevista y cómo se construye ---
  lines.push(T.objectiveHeader, T.objective, T.methodHeader, ...T.methodSteps);

  // --- Comportamiento del nivel: no es solo tono, define qué hace en cada situación ---
  lines.push(T.behaviorHeader);
  lines.push(`- ${L.tone}: ${level.persona}`);
  lines.push(`- ${L.approach}: ${level.approach}`);
  lines.push(`- ${L.formulate}: ${level.formulate}`);
  lines.push(`- ${L.press}: ${level.press}`);
  lines.push(`- ${L.evasion}: ${level.evasion}`);
  lines.push(`- ${L.contradiction}: ${level.contradiction}`);
  lines.push(`- ${L.advance}: ${level.advance}`);

  // --- Límites que ningún nivel puede cruzar (inventar, insultar, inducir, forzar líneas rojas) ---
  lines.push(T.prohibitedHeader, ...T.prohibitions);

  // El idioma se declara en cada solicitud: el entrevistador pregunta en el idioma de la práctica.
  lines.push(T.languageHeader, ...T.languageRules);
  // Tipo real del turno. `plan.kind` es la estructura nominal y puede contradecir la intervención
  // que de verdad se envía (una repregunta adaptativa decidida por la evaluación, por ejemplo).
  const isFollowUp = (turn.kind || plan.kind) === 'followup';

  if (theme) {
    lines.push(T.scenario(theme.title), T.context(theme.context));
    // Contexto disponible de la organización y del escenario. No se inventa nada: si un dato no
    // existe (sector, óptica o público), simplemente no se incluye.
    if (tenant?.name) lines.push(T.org(tenant.name, tenant.sector));
    if (theme.optic) lines.push(T.optic(theme.optic));
    const publics = parseList(theme.publics);
    if (publics.length) lines.push(T.publics(publics));
    const keyMessages = parseList(theme.keyMessages);
    const redLines = parseList(theme.redLines);
    if (keyMessages.length) lines.push(T.keyMessages(keyMessages));
    if (redLines.length) lines.push(T.redLines(redLines));
  } else {
    lines.push(T.scenarioDefault);
  }

  // --- Memoria de la entrevista: lo ya hecho, lo ya dicho y lo que falta ---
  if (memory) {
    const labels = T.factsLabels;
    const facts = [];
    if (memory.figures.length) facts.push(T.memoryFacts(labels.figures, memory.figures));
    if (memory.dates.length) facts.push(T.memoryFacts(labels.dates, memory.dates));
    if (memory.commitments.length) facts.push(T.memoryFacts(labels.commitments, memory.commitments));
    if (memory.actors.length) facts.push(T.memoryFacts(labels.actors, memory.actors));
    lines.push(T.memoryHeader);
    if (memory.turn && memory.total) {
      lines.push(T.memoryTurn(memory.turn, memory.total, memory.mainNumber ?? 1, memory.mainsTotal ?? '—'));
    }
    if (memory.mains.length) lines.push(T.memoryMains(memory.mains));
    if (memory.asked?.length) lines.push(T.memoryTopics(memory.asked));
    if (memory.answered?.length) lines.push(T.memoryAnswered(memory.answered));
    if (memory.needsClarification?.length) lines.push(T.memoryNeeds(memory.needsClarification));
    if (memory.notAsked?.length) lines.push(T.memoryPending(memory.notAsked));
    lines.push(...facts);
    if (memory.tension) lines.push(T.memoryTension(memory.tension));
    lines.push(T.memoryNotAnswered, T.memoryAdvice);
  }

  lines.push(T.rulesHeader, T.oneQuestion(QUESTION_TARGET_WORDS, MAX_QUESTION_WORDS));
  if (silent) {
    // El vocero no respondió: el entrevistador no lo deja pasar
    lines.push(cfg.aggressiveness === 'BAJA' ? T.silentLow : T.silentHigh);
  } else if (cfg.followUps > 0 || isFollowUp) {
    // Una repregunta decidida por la evaluación puede ocurrir aunque la configuración no tenga
    // repreguntas fijas: en ese caso la instrucción debe describir el turno real, no el plan.
    // Estructura fija: cada pregunta principal va seguida de sus repreguntas
    lines.push(isFollowUp ? T.followUpTurn : T.newQuestion);
    // La instrucción de silencio solo vale cuando de verdad no hay respuesta: si se detectó voz y
    // falló la transcripción, la intervención es neutral y no afirma lo que el vocero dijo.
    if (turn.hasTranscript !== false) lines.push(T.noAnswerInsist);
  } else {
    lines.push(T.evasive);
  }
  // Contexto de la repregunta: la pregunta principal en curso, el aspecto pendiente y el estado
  // real de la respuesta. La repregunta se apoya en lo que el vocero dijo, no en el plan interno.
  if (isFollowUp) {
    if (turn.mainQuestion) lines.push(T.mainInProgress(String(turn.mainQuestion).slice(0, 300)));
    // B3: con foco se declara primero la regla del turno, despues el aspecto pendiente y por
    // ultimo el caso de foco no utilizable. Sin foco, el prompt queda exactamente como antes.
    if (turn.focus) {
      lines.push(T.followUpFocusRule);
      lines.push(T.pendingFocus(String(turn.focus).slice(0, 300)));
      lines.push(T.followUpFocusFallback);
    }
    if (turn.hasTranscript === false) lines.push(T.noTranscript);
  }
  // Estado de la última respuesta según el análisis ya existente. El clasificador no se
  // modifica: aquí solo se usa su resultado para que el entrevistador actúe según su nivel.
  if (assessment?.status && !silent) lines.push(T.assessment(assessment.status));
  lines.push(T.noRepeat, T.onlyQuestion);
  return lines.join('\n');
}

// Etiqueta del turno del vocero sin texto: distingue el silencio real de una respuesta que no se
// pudo transcribir.
const noAnswerLabel = (turn, lang = 'es') => {
  const T = textsFor(lang);
  return turn?.spoke === true ? T.spokeNoText : T.silence;
};

// history: [{ role: 'interviewer' | 'vocero', text: string, spoke?: boolean }]
// `turn` es el turno real que se pide (kind/mainQuestion/focus/hasTranscript) y se usa para que el
// prompt describa la intervención que de verdad se envía. `lang` es el idioma efectivo del vocero.
function buildMessages(theme, history = [], cfg, plan, turn = {}, lang = 'es', extras = {}) {
  const T = textsFor(lang);
  // Silencio real: el último turno es del vocero, sin texto y sin voz detectada
  const last = history[history.length - 1];
  const silent = Boolean(last && last.role !== 'interviewer' && !(last.text || '').trim() && last.spoke !== true);
  // La memoria estructurada se calcula UNA vez por pregunta (o se inyecta en las pruebas).
  // `resolutions` (estado del clasificador por turno) llega desde la sesión: sin él, los temas
  // quedan solo como preguntados y nunca se asumen respondidos.
  const memory =
    extras.memory || buildMemory({ history, cfg, plan, lang, resolutions: extras.resolutions || [] });
  const messages = [
    {
      role: 'system',
      content: buildSystemPrompt(theme, cfg, plan, turn, silent, lang, {
        memory,
        tenant: extras.tenant || theme?.tenant || null,
        assessment: extras.assessment || (turn?.assessmentStatus ? { status: turn.assessmentStatus } : null),
      }),
    },
  ];

  for (const item of history.slice(-10)) {
    const text = (item.text || '').trim();
    messages.push({
      role: item.role === 'interviewer' ? 'assistant' : 'user',
      content: item.role === 'interviewer' ? text : T.answerPrefix(text || noAnswerLabel(item, lang)),
    });
  }

  if (history.length === 0) {
    messages.push({ role: 'user', content: T.startInterview });
  }
  return messages;
}

// Limpia la respuesta: una sola línea, sin comillas ni prefijos.
// Algunos modelos a veces devuelven su "razonamiento" (en inglés) en vez de la
// pregunta: en ese caso se descarta y se usa la respuesta de otro modelo.
// `lang` es el idioma de la entrevista: el filtro de razonamiento en inglés solo se aplica cuando
// la pregunta esperada es en español (en inglés descartaría la pregunta válida).
const ENGLISH_HINTS = /\b(the|they|which|journalist|should|question|user|needs?|answer)\b/i;

function cleanQuestion(text, lang = 'es') {
  const lines = text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .split('\n')
    .map((l) =>
      l
        .replace(/\*/g, '') // negritas de markdown
        .trim()
        .replace(/^(pregunta|periodista|question|journalist)\s*[:.-]\s*/i, '')
        .replace(/^["“«]+|["”»]+$/g, '')
        .trim(),
    )
    .filter(Boolean);

  // La última línea que parezca una pregunta
  const candidate = [...lines].reverse().find((l) => l.includes('?') || l.includes('¿'));
  if (!candidate) return null;
  if (lang !== 'en' && ENGLISH_HINTS.test(candidate) && !candidate.includes('¿')) return null;
  if (candidate.split(/\s+/).length > MAX_QUESTION_WORDS) return null;
  return candidate;
}

// Consulta UN modelo. Cada llamada tiene su PROPIO temporizador y, opcionalmente, una señal
// externa (cierre real de sesión). No comparte `AbortController` con otros modelos: una
// respuesta válida de otro modelo no cancela esta solicitud.
async function askModel(model, messages, { timeoutMs = 20000, signal = null, fetchImpl = fetch, raw = false, now = () => Date.now(), lang = 'es' } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const combined = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal;
  const started = now();

  try {
    const response = await fetchImpl(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      signal: combined,
      headers: {
        Authorization: `Bearer ${process.env.NVIDIA_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        // `raw: true` (evaluación de respuestas) pide JSON: temperatura baja y más tokens.
        temperature: raw ? 0.2 : 0.7,
        max_tokens: raw ? 500 : 200,
        // Desactiva el modo "razonamiento" de DeepSeek: es mucho más lento
        ...(model.startsWith('deepseek') ? { chat_template_kwargs: { thinking: false } } : {}),
        // Nemotron razona por defecto y gasta ahí los 200 tokens sin llegar a escribir la pregunta
        ...(model.includes('nemotron') ? { chat_template_kwargs: { enable_thinking: false } } : {}),
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
    }

    const data = await response.json();
    const content = String(data.choices?.[0]?.message?.content || '');
    // Modo `raw`: devuelve el texto tal cual (evaluación de suficiencia, JSON). NO valida que sea
    // una pregunta y no altera el comportamiento por defecto del entrevistador.
    if (raw) {
      if (!content.trim()) throw new Error('respuesta vacia del modelo');
      return { text: content, model, ms: now() - started };
    }
    const question = cleanQuestion(content, lang);
    if (!question) throw new Error('respuesta descartada: no era una pregunta válida');
    return { question, model, ms: now() - started };
  } finally {
    clearTimeout(timer);
  }
}

// Alias de `askModel` sin señal compartida entre modelos.
const callModel = (model, messages, timeoutMs) => askModel(model, messages, { timeoutMs });

// FUENTE UNICA de la lista de modelos del entrevistador (A1). La consumen la generacion de
// preguntas (`generateQuestion`), el despacho de la sesion y el clasificador de respuestas (ambos
// a traves de la dependencia `models` de `routes/interviewer.js`) y el warm-up (que llama a
// `generateQuestion`).
// Orden: AI_MODEL, AI_FALLBACK_MODEL y despues AI_EXTRA_MODELS, sin duplicados. Aqui no se anade,
// se quita ni se renombra ningun modelo: la lista sale exclusivamente de la configuracion.
function interviewModels() {
  const extra = (process.env.AI_EXTRA_MODELS ?? DEFAULT_EXTRA).split(',').map((m) => m.trim()).filter(Boolean);
  return [...new Set([process.env.AI_MODEL || DEFAULT_MODEL, process.env.AI_FALLBACK_MODEL || DEFAULT_FALLBACK, ...extra])];
}

function interviewTimeoutMs() {
  return Number(process.env.AI_TIMEOUT_MS) || 20000;
}

// Adaptador para `interviewSession.js`: recibe el contexto central y devuelve { question }.
// El contexto debe traer `messages` ya construidos, o bien `theme/history/cfg/plan` para
// construirlos con la misma función que usa producción (`buildMessages`).
function askModelFromContext(model, context = {}, options = {}) {
  let messages;
  try {
    // `cfg`/`plan` pueden faltar si el llamador no los adjuntó: se derivan con las funciones
    // reales del proyecto (mismo diseño: un tema sin configuración usa los valores por defecto).
    const cfg = context.cfg || normalizeInterviewConfig(context.theme?.interviewConfig);
    const plan =
      context.plan || turnPlan(cfg, (context.history || []).filter((turn) => turn.role === 'interviewer').length);
    // Turno real que se está pidiendo: el `kind` del contexto manda sobre el plan nominal, y el
    // foco/estado de la respuesta viajan al prompt para que la repregunta se apoye en lo dicho.
    const turn = {
      kind: context.kind || null,
      mainQuestion: context.mainQuestion || null,
      focus: context.focus || null,
      hasTranscript: typeof context.hasTranscript === 'boolean' ? context.hasTranscript : null,
      // Estado de la última respuesta (ya calculado por el clasificador existente): el prompt lo
      // usa para que el entrevistador actúe según su nivel, sin recalcular nada aquí.
      assessmentStatus: context.assessmentStatus || null,
    };
    messages =
      context.messages ||
      buildMessages(context.theme, context.history || [], cfg, plan, turn, context.lang, {
        tenant: context.tenant || null,
        assessment: context.assessmentStatus ? { status: context.assessmentStatus } : null,
        // Estado por turno del clasificador: permite distinguir tema preguntado de tema respondido.
        resolutions: context.resolutions || [],
      });
  } catch (error) {
    // Fallo al preparar la solicitud: NO es un error del proveedor. Se etiqueta para que el
    // orquestador lo registre como tal en vez de como 4 fallos de modelos distintos.
    error.code = 'CONTEXT_BUILD_FAILED';
    throw error;
  }
  return askModel(model, messages, { lang: context.lang, ...options });
}

// Consulta el modelo principal y el de respaldo EN paralelo y usa la primera
// respuesta válida. En el plan gratuito los modelos populares (como DeepSeek)
// pueden tener cola; así la entrevista no queda esperando.
async function generateQuestion({ theme, history, lang = 'es' }) {
  if (!process.env.NVIDIA_API_KEY) {
    const error = new Error('Falta NVIDIA_API_KEY en backend/.env.local');
    error.code = 'NO_API_KEY';
    throw error;
  }

  // La estructura de la entrevista depende de cuántas preguntas ya hizo el entrevistador
  const cfg = normalizeInterviewConfig(theme?.interviewConfig);
  const plan = turnPlan(cfg, history.filter((turn) => turn.role === 'interviewer').length);
  const messages = buildMessages(theme, history, cfg, plan, {}, lang);
  const timeoutMs = Number(process.env.AI_TIMEOUT_MS) || 20000;
  // A1: la lista de modelos se toma de la FUENTE UNICA (`interviewModels()`), la misma que usan el
  // clasificador y el warm-up. Antes estaba duplicada aqui con la misma formula: el resultado es
  // identico (mismo orden, mismos identificadores, misma deduplicacion).
  const models = interviewModels();
  const start = Date.now();

  const attempts = models.map((model) =>
    askModel(model, messages, { timeoutMs, lang })
      .then((result) => ({ ...result, ms: Date.now() - start, plan }))
      .catch((error) => {
        const reason = error?.name === 'AbortError' ? `sin respuesta en ${timeoutMs} ms` : error.message;
        console.warn(`[IA] ${model} falló: ${reason}`);
        throw new Error(`${model}: ${reason}`);
      }),
  );

  // Las solicitudes perdedoras NO se cancelan: siguen vivas y sus errores quedan gestionados
  // (sin `unhandledRejection`). Sus respuestas tardías las aprovechará la orquestación.
  attempts.forEach((attempt) => attempt.catch(() => {}));

  try {
    const winner = await Promise.any(attempts);
    recordAi('interviewer', true, winner);
    return winner;
  } catch (aggregate) {
    recordAi('interviewer', false, { error: 'Ningún modelo respondió' });
    throw new Error(`Ningún modelo respondió (${aggregate.errors.map((e) => e.message).join(' | ')})`);
  }
}

// Los modelos gratuitos "se duermen" si nadie los usa y la primera consulta
// puede tardar mucho. Al iniciar el servidor se hace una consulta silenciosa.
function warmUp() {
  if (!process.env.NVIDIA_API_KEY) return;
  generateQuestion({ theme: null, history: [] })
    .then((r) => console.log(`[IA] Entrevistador listo (${r.model}, ${r.ms} ms)`))
    .catch(() => console.warn('[IA] No se pudo precalentar el modelo; se reintentará en la primera pregunta'));
}

module.exports = {
  generateQuestion,
  warmUp,
  parseList,
  buildSystemPrompt,
  buildMessages,
  buildMemory,
  detectTopics,
  detectTension,
  tensionNote,
  isReservedQuestionStale,
  TOPIC_LADDER,
  QUESTION_TARGET_WORDS,
  MAX_QUESTION_WORDS,
  askModel,
  askModelFromContext,
  cleanQuestion,
  interviewModels,
  interviewTimeoutMs,
};
