// Entrevistador IA: genera la siguiente pregunta usando la API de NVIDIA
// (compatible con OpenAI). Configuración en backend/.env.local:
//   NVIDIA_API_KEY=nvapi-...
//   AI_MODEL=deepseek-ai/deepseek-v4.1-flash          (modelo principal)
//   AI_FALLBACK_MODEL=google/gemma-4-31b-it           (respaldo si el principal no responde)
//   AI_TIMEOUT_MS=20000                               (espera máxima por modelo)

const BASE_URL = 'https://integrate.api.nvidia.com/v1';

const DEFAULT_MODEL = 'deepseek-ai/deepseek-v4.1-flash';
const DEFAULT_FALLBACK = 'google/gemma-4-31b-it';

// Instrucciones del periodista. El escenario se completa con datos de la tabla Theme.
function buildSystemPrompt(theme) {
  const scenario = theme
    ? `Escenario: ${theme.title}.\nContexto: ${theme.context}\nMensajes que el vocero intentará sostener: ${theme.keyMessages}`
    : 'Escenario: una empresa enfrenta una crisis que afecta a sus clientes.';

  return [
    'Eres un periodista chileno, incisivo pero respetuoso, entrevistando en vivo al vocero de una organización.',
    scenario,
    'Reglas:',
    '- Haz UNA sola pregunta, en español, de máximo 35 palabras.',
    '- Si el vocero evade o responde de forma genérica, repregunta sobre lo que no contestó.',
    '- Si el vocero no dijo nada, reformula la pregunta anterior de forma más directa.',
    '- Responde solo con la pregunta: sin saludos, comillas, explicaciones ni etiquetas.',
  ].join('\n');
}

// history: [{ role: 'interviewer' | 'vocero', text: string }]
function buildMessages(theme, history = []) {
  const messages = [{ role: 'system', content: buildSystemPrompt(theme) }];

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
function cleanQuestion(text) {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .pop()
    ?.replace(/^(pregunta|periodista)\s*:\s*/i, '')
    .replace(/^["“«]+|["”»]+$/g, '')
    .trim();
}

async function callModel(model, messages, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
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
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
    }

    const data = await response.json();
    const question = cleanQuestion(data.choices?.[0]?.message?.content || '');
    if (!question) throw new Error('El modelo no devolvió texto');
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

  const messages = buildMessages(theme, history);
  const timeoutMs = Number(process.env.AI_TIMEOUT_MS) || 20000;
  const models = [...new Set([process.env.AI_MODEL || DEFAULT_MODEL, process.env.AI_FALLBACK_MODEL || DEFAULT_FALLBACK])];
  const start = Date.now();

  const attempts = models.map((model) =>
    callModel(model, messages, timeoutMs)
      .then((question) => ({ question, model, ms: Date.now() - start }))
      .catch((error) => {
        const reason = error.name === 'AbortError' ? `sin respuesta en ${timeoutMs} ms` : error.message;
        console.warn(`[IA] ${model} falló: ${reason}`);
        throw new Error(`${model}: ${reason}`);
      }),
  );

  try {
    return await Promise.any(attempts);
  } catch (aggregate) {
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

module.exports = { generateQuestion, warmUp };
