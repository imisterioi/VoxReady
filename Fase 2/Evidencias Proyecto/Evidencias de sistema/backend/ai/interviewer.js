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

// Instrucciones del entrevistador. El escenario se completa con datos de la tabla Theme;
// el tono y la estructura (preguntas y repreguntas) vienen de su configuración de entrevista.
// `turn` describe el turno REAL que se está pidiendo: { kind, mainQuestion, focus, hasTranscript }.
function buildSystemPrompt(theme, cfg, plan, turn = {}) {
  const level = AGGRESSIVENESS[cfg.aggressiveness];
  const who = cfg.interviewerRole || 'un periodista chileno';
  const lines = [`Eres ${who} y entrevistas en vivo al vocero de una organización.`, level.persona];
  // Tipo REAL del turno. `plan.kind` es la estructura nominal y puede contradecir la intervención
  // que de verdad se envía (una repregunta adaptativa decidida por la evaluación, por ejemplo).
  const isFollowUp = (turn.kind || plan.kind) === 'followup';

  if (theme) {
    lines.push(`Escenario: ${theme.title}.`, `Contexto: ${theme.context}`);
    const keyMessages = parseList(theme.keyMessages);
    const redLines = parseList(theme.redLines);
    if (keyMessages.length) lines.push(`Mensajes que el vocero intentará sostener: ${keyMessages.join(' | ')}`);
    if (redLines.length) {
      lines.push(`Cosas que el vocero NO debe decir (líneas rojas): ${redLines.join(' | ')}`);
      if (cfg.aggressiveness === 'ALTA' || cfg.aggressiveness === 'EXTREMA') {
        lines.push('Busca activamente que el vocero cruce esas líneas rojas con preguntas que lo tienten a hacerlo.');
      } else if (cfg.aggressiveness === 'MEDIA') {
        lines.push('De vez en cuando formula preguntas que tienten al vocero a cruzar esas líneas rojas.');
      }
    }
  } else {
    lines.push('Escenario: una empresa enfrenta una crisis que afecta a sus clientes.');
  }

  lines.push('Reglas:', '- Haz UNA sola pregunta, en español, de máximo 35 palabras.');
  // Una repregunta decidida por la evaluación puede ocurrir aunque la configuración no tenga
  // repreguntas fijas: en ese caso la instrucción debe describir el turno REAL, no el plan.
  if (cfg.followUps > 0 || isFollowUp) {
    // Estructura fija: cada pregunta principal va seguida de sus repreguntas
    lines.push(
      isFollowUp
        ? `- Este turno es una REPREGUNTA sobre la última respuesta del vocero. ${level.followUp}`
        : '- Este turno es una pregunta NUEVA: aborda un aspecto de la situación que todavía no se haya tratado.',
    );
    // La instrucción de silencio solo vale cuando de verdad no hay respuesta: si se detectó voz y
    // falló la transcripción, la intervención es neutral y no afirma lo que el vocero dijo.
    if (turn.hasTranscript !== false) {
      lines.push('- Si el vocero no dijo nada, insiste en la pregunta anterior de forma más directa.');
    }
  } else {
    lines.push(
      `- Si el vocero evade o responde de forma genérica, repregunta. ${level.followUp}`,
      '- Si el vocero no dijo nada, reformula la pregunta anterior de forma más directa.',
    );
  }
  // Contexto de la repregunta: la pregunta principal en curso, el aspecto pendiente y el estado
  // real de la respuesta. La repregunta se apoya en lo que el vocero dijo, no en el plan interno.
  if (isFollowUp) {
    if (turn.mainQuestion) lines.push(`- Pregunta principal en curso: "${String(turn.mainQuestion).slice(0, 300)}"`);
    if (turn.focus) lines.push(`- Aspecto pendiente que debe aclarar: ${String(turn.focus).slice(0, 300)}`);
    if (turn.hasTranscript === false) {
      lines.push('- No hay transcripción utilizable de su última respuesta: pide una aclaración concreta sobre el punto central, sin afirmar lo que dijo.');
    }
  }
  lines.push(
    '- No repitas preguntas que ya hiciste.',
    '- Responde solo con la pregunta: sin saludos, comillas, explicaciones ni etiquetas.',
  );
  return lines.join('\n');
}

// Etiqueta del turno del vocero sin texto: distingue el SILENCIO real de una respuesta hablada que
// no se pudo transcribir. Nunca se inventa su contenido.
const noAnswerLabel = (turn) => (turn?.spoke === true ? '(habló, pero no se pudo transcribir su respuesta)' : '(silencio, no respondió)');

// history: [{ role: 'interviewer' | 'vocero', text: string, spoke?: boolean }]
// `turn` es el turno REAL que se pide (kind/mainQuestion/focus/hasTranscript) y se usa para que el
// prompt describa la intervención que de verdad se envía.
function buildMessages(theme, history = [], cfg, plan, turn = {}) {
  const messages = [{ role: 'system', content: buildSystemPrompt(theme, cfg, plan, turn) }];

  for (const item of history.slice(-10)) {
    const text = (item.text || '').trim();
    messages.push({
      role: item.role === 'interviewer' ? 'assistant' : 'user',
      content: item.role === 'interviewer' ? text : `Respuesta del vocero: ${text || noAnswerLabel(item)}`,
    });
  }

  if (history.length === 0) {
    messages.push({ role: 'user', content: 'Comienza la entrevista con tu primera pregunta.' });
  }
  return messages;
}

// Limpia la respuesta: una sola línea, sin comillas ni prefijos.
// Algunos modelos a veces devuelven su "razonamiento" (en inglés) en vez de la
// pregunta: en ese caso se descarta y se usa la respuesta de otro modelo.
const ENGLISH_HINTS = /\b(the|they|which|journalist|should|question|user|needs?|answer)\b/i;

function cleanQuestion(text) {
  const lines = text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .split('\n')
    .map((l) =>
      l
        .replace(/\*/g, '') // negritas de markdown
        .trim()
        .replace(/^(pregunta|periodista)\s*[:.-]\s*/i, '')
        .replace(/^["“«]+|["”»]+$/g, '')
        .trim(),
    )
    .filter(Boolean);

  // La última línea que parezca una pregunta en español
  const candidate = [...lines].reverse().find((l) => l.includes('?') || l.includes('¿'));
  if (!candidate) return null;
  if (ENGLISH_HINTS.test(candidate) && !candidate.includes('¿')) return null;
  if (candidate.split(/\s+/).length > 70) return null;
  return candidate;
}

// Consulta UN modelo. Cada llamada tiene su PROPIO temporizador y, opcionalmente, una señal
// externa (cierre real de sesión). No comparte `AbortController` con otros modelos: una
// respuesta válida de otro modelo no cancela esta solicitud.
async function askModel(model, messages, { timeoutMs = 20000, signal = null, fetchImpl = fetch, raw = false, now = () => Date.now() } = {}) {
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
    const question = cleanQuestion(content);
    if (!question) throw new Error('respuesta descartada: no era una pregunta en español');
    return { question, model, ms: now() - started };
  } finally {
    clearTimeout(timer);
  }
}

// Compatibilidad con el código anterior (sin señal compartida entre modelos).
const callModel = (model, messages, timeoutMs) => askModel(model, messages, { timeoutMs });

// Modelos habilitados y timeout efectivos (misma fórmula que usaba generateQuestion).
function interviewModels() {
  const extra = (process.env.AI_EXTRA_MODELS ?? DEFAULT_EXTRA).split(',').map((m) => m.trim()).filter(Boolean);
  return [...new Set([process.env.AI_MODEL || DEFAULT_MODEL, process.env.AI_FALLBACK_MODEL || DEFAULT_FALLBACK, ...extra])];
}

function interviewTimeoutMs() {
  return Number(process.env.AI_TIMEOUT_MS) || 20000;
}

// Adaptador para `interviewSession.js`: recibe el contexto central y devuelve { question }.
// El contexto debe traer `messages` ya construidos, o bien `theme/history/cfg/plan` para
// construirlos con la MISMA función que usa producción (`buildMessages`).
function askModelFromContext(model, context = {}, options = {}) {
  let messages;
  try {
    // `cfg`/`plan` pueden faltar si el llamador no los adjuntó: se derivan con las funciones
    // REALES del proyecto (mismo diseño: un tema sin configuración usa los valores por defecto).
    const cfg = context.cfg || normalizeInterviewConfig(context.theme?.interviewConfig);
    const plan =
      context.plan || turnPlan(cfg, (context.history || []).filter((turn) => turn.role === 'interviewer').length);
    // Turno REAL que se está pidiendo: el `kind` del contexto manda sobre el plan nominal, y el
    // foco/estado de la respuesta viajan al prompt para que la repregunta se apoye en lo dicho.
    const turn = {
      kind: context.kind || null,
      mainQuestion: context.mainQuestion || null,
      focus: context.focus || null,
      hasTranscript: typeof context.hasTranscript === 'boolean' ? context.hasTranscript : null,
    };
    messages = context.messages || buildMessages(context.theme, context.history || [], cfg, plan, turn);
  } catch (error) {
    // Fallo al preparar la solicitud: NO es un error del proveedor. Se etiqueta para que el
    // orquestador lo registre como tal en vez de como 4 fallos de modelos distintos.
    error.code = 'CONTEXT_BUILD_FAILED';
    throw error;
  }
  return askModel(model, messages, options);
}

// Consulta el modelo principal y el de respaldo EN PARALELO y usa la primera
// respuesta válida. En el plan gratuito los modelos populares (como DeepSeek)
// pueden tener cola; así la entrevista no queda esperando.
async function generateQuestion({ theme, history }) {
  if (!process.env.NVIDIA_API_KEY) {
    const error = new Error('Falta NVIDIA_API_KEY en backend/.env.local');
    error.code = 'NO_API_KEY';
    throw error;
  }

  // La estructura de la entrevista depende de cuántas preguntas ya hizo el entrevistador
  const cfg = normalizeInterviewConfig(theme?.interviewConfig);
  const plan = turnPlan(cfg, history.filter((turn) => turn.role === 'interviewer').length);
  const messages = buildMessages(theme, history, cfg, plan);
  const timeoutMs = Number(process.env.AI_TIMEOUT_MS) || 20000;
  const extra = (process.env.AI_EXTRA_MODELS ?? DEFAULT_EXTRA).split(',').map((m) => m.trim()).filter(Boolean);
  const models = [...new Set([process.env.AI_MODEL || DEFAULT_MODEL, process.env.AI_FALLBACK_MODEL || DEFAULT_FALLBACK, ...extra])];
  const start = Date.now();

  const attempts = models.map((model) =>
    askModel(model, messages, { timeoutMs })
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

module.exports = { generateQuestion, warmUp, parseList, buildSystemPrompt, askModel, askModelFromContext, cleanQuestion, interviewModels, interviewTimeoutMs };
