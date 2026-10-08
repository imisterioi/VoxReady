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
const DEFAULT_EXTRA = 'moonshotai/kimi-k3,nvidia/nemotron-3-super-120b-a12b';

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
function buildSystemPrompt(theme, cfg, plan) {
  const level = AGGRESSIVENESS[cfg.aggressiveness];
  const who = cfg.interviewerRole || 'un periodista chileno';
  const lines = [`Eres ${who} y entrevistas en vivo al vocero de una organización.`, level.persona];

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
  if (cfg.followUps > 0) {
    // Estructura fija: cada pregunta principal va seguida de sus repreguntas
    lines.push(
      plan.kind === 'followup'
        ? `- Este turno es una REPREGUNTA sobre la última respuesta del vocero. ${level.followUp}`
        : '- Este turno es una pregunta NUEVA: aborda un aspecto de la situación que todavía no se haya tratado.',
      '- Si el vocero no dijo nada, insiste en la pregunta anterior de forma más directa.',
    );
  } else {
    lines.push(
      `- Si el vocero evade o responde de forma genérica, repregunta. ${level.followUp}`,
      '- Si el vocero no dijo nada, reformula la pregunta anterior de forma más directa.',
    );
  }
  lines.push(
    '- No repitas preguntas que ya hiciste.',
    '- Responde solo con la pregunta: sin saludos, comillas, explicaciones ni etiquetas.',
  );
  return lines.join('\n');
}

// history: [{ role: 'interviewer' | 'vocero', text: string }]
function buildMessages(theme, history = [], cfg, plan) {
  const messages = [{ role: 'system', content: buildSystemPrompt(theme, cfg, plan) }];

  for (const turn of history.slice(-10)) {
    const text = (turn.text || '').trim();
    messages.push({
      role: turn.role === 'interviewer' ? 'assistant' : 'user',
      content: turn.role === 'interviewer' ? text : `Respuesta del vocero: ${text || '(silencio, no respondió)'}`,
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

async function callModel(model, messages, timeoutMs, raceSignal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  // Se cancela por tiempo o cuando otro modelo ya respondió
  const signal = raceSignal ? AbortSignal.any([controller.signal, raceSignal]) : controller.signal;

  try {
    const response = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      signal,
      headers: {
        Authorization: `Bearer ${process.env.NVIDIA_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.7,
        max_tokens: 200,
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
    const question = cleanQuestion(data.choices?.[0]?.message?.content || '');
    if (!question) throw new Error('respuesta descartada: no era una pregunta en español');
    return question;
  } finally {
    clearTimeout(timer);
  }
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
  const race = new AbortController();

  const attempts = models.map((model) =>
    callModel(model, messages, timeoutMs, race.signal)
      .then((question) => ({ question, model, ms: Date.now() - start, plan }))
      .catch((error) => {
        if (race.signal.aborted) throw new Error(`${model}: cancelado`); // otro modelo ganó
        const reason = error.name === 'AbortError' ? `sin respuesta en ${timeoutMs} ms` : error.message;
        console.warn(`[IA] ${model} falló: ${reason}`);
        throw new Error(`${model}: ${reason}`);
      }),
  );

  try {
    const winner = await Promise.any(attempts);
    race.abort(); // cancela las consultas que siguen pendientes
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

module.exports = { generateQuestion, warmUp, parseList, buildSystemPrompt };
