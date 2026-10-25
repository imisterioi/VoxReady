// SONDA REAL de modelos evaluadores (llamadas REALES al proveedor: consume créditos).
//
//   cd backend
//   node scripts/probe-evaluator-models.js                     # fase 1: contrato (barato)
//   node scripts/probe-evaluator-models.js --full              # fase 2: informe completo (coste real)
//   node scripts/probe-evaluator-models.js --models a,b --timeout-ms 120000
//
// POR QUÉ EXISTE
// Estar en el catálogo del proveedor NO significa que el modelo acepte `chat/completions` (varios
// aparecen listados y responden 404/410). Y responder al contrato NO significa completar un informe:
// algunos modelos razonan, agotan `max_tokens` y devuelven `finish_reason: length`.
//
// QUÉ HACE
//  - Fase 1 (por defecto): petición mínima (64 tokens) para comprobar disponibilidad real.
//  - Fase 2 (`--full`): usa EL MISMO prompt que la evaluación real (`buildPrompt`) con la entrada
//    sintética de este archivo y valida la respuesta con `validateJudgement` (criterios y puntajes
//    del patrón activo). Es la única forma de afirmar que un modelo "genera un informe válido".
//
// QUÉ NO HACE
//  - No toca la base de datos, no usa sesiones reales, no imprime la clave ni texto del vocero
//    (la entrada es sintética). No forma parte de la suite de pruebas: se ejecuta a mano.
//  - No escribe configuración: solo informa. Habilitar modelos es una decisión aparte.
const fs = require('node:fs');
const path = require('node:path');

const { buildPrompt, validateJudgement } = require('../ai/evaluator');
const { resolveConfig } = require('../ai/patternConfig');

const BASE_URL = 'https://integrate.api.nvidia.com/v1';

// Carga mínima de .env.local (mismo patrón que scripts/verify-nvidia-chain.js). Nunca imprime valores.
const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim();
  }
}

// Candidatos a evaluador presentes en el catálogo real del proveedor (consultado con
// `/v1/models`). La lista es solo el punto de partida de la sonda: no se habilita nada sin pasar
// la fase correspondiente.
const CANDIDATOS = [
  'z-ai/glm-5.3', // control: único modelo ya validado a tamaño de informe
  'nvidia/nemotron-3-ultra-550b-a55b',
  'nvidia/nemotron-3-super-120b-a12b',
  'nvidia/nemotron-nano-3-30b-a3b',
  'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning',
  'nvidia/nemotron-4-340b-instruct',
  'nvidia/llama-3.1-nemotron-ultra-253b-v1',
  'nvidia/nemotron-3.5-lightning-30b-a3b',
  'nvidia/nemotron-3.5-super-vl-120b-a12b',
  'openai/gpt-oss-20b',
  'minimaxai/minimax-m3.1-flash',
  'mistralai/mistral-large',
  'moonshotai/kimi-k2.6',
  'google/gemma-4-31b-it',
  'deepseek-ai/deepseek-v4.1-flash',
  'z-ai/glm-5.3-flash',
  'ibm/granite-3.0-8b-instruct',
  'mistralai/mistral-7b-instruct-v0.3',
];

// Entrada SINTÉTICA equivalente en forma a una entrevista real (tema, turnos, métricas).
const THEME = {
  id: 'sonda',
  title: 'Accidente en planta',
  context: 'Derrame químico sin heridos durante el turno de noche.',
  optic: 'Institucional',
  keyMessages: JSON.stringify(['Activamos el protocolo', 'Colaboramos con la autoridad']),
  redLines: JSON.stringify(['No especular con las causas']),
  interviewConfig: { aggressiveness: 'MEDIA', questionCount: 6, followUps: 1 },
};

const ANSWERS = [
  'A las 3:10 el sensor de la línea 4 detectó una fuga y activamos el protocolo de contención.',
  'Evacuamos la zona, avisamos al jefe de turno y cerramos la válvula principal en cinco minutos.',
  'No hubo heridos. Dos compañeros pasaron por el servicio médico por precaución y están bien.',
  'La causa exacta la está determinando el equipo técnico con la autoridad; no voy a especular.',
  'Aprendimos que la válvula necesitaba mantenimiento antes y ya está planificado para esta semana.',
  'Con la comunidad mantuvimos una reunión informativa y publicamos un comunicado verificado.',
];

const TRANSCRIPT = ANSWERS.map((answer, index) => ({
  question: `¿Pregunta ${index + 1}?`,
  answer,
  metrics: { wpm: 132, fillers: 1, latencyMs: 900 },
}));

const METRICS = {
  voice: { available: true, wpm: 132, fillers: 1, pauseCount: 1, variation: 55 },
  body: { available: true, faceAvailable: true, smileSeconds: 2, facingCamera: 0.8 },
  lighting: { available: true, lux: 320 },
};

function reportInput() {
  const cfg = resolveConfig(null);
  return { theme: THEME, transcript: TRANSCRIPT, voice: METRICS.voice, body: METRICS.body, lighting: METRICS.lighting, cfg };
}

const CONTRACT_MESSAGES = [
  { role: 'system', content: 'Responde SOLO con un objeto JSON válido, sin markdown.' },
  { role: 'user', content: 'Devuelve exactamente: {"coherencia":{"claridad":50},"empatia":{"escucha":50}}' },
];

function extractJson(text) {
  const clean = String(text || '').replace(/```(?:json)?/gi, '');
  const start = clean.indexOf('{');
  const end = clean.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('sin JSON');
  return JSON.parse(clean.slice(start, end + 1).replace(/,\s*([}\]])/g, '$1'));
}


// Una llamada real. `timeoutMs` acota SOLO la sonda (no es la política del producto).
async function callModel({ model, messages, maxTokens, timeoutMs, apiKey }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const response = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, temperature: 0.3, max_tokens: maxTokens, response_format: { type: 'json_object' } }),
    });
    const body = await response.json().catch(() => null);
    return { ms: Date.now() - started, status: response.status, ok: response.ok, body };
  } catch (error) {
    const aborted = error?.name === 'AbortError';
    return {
      ms: Date.now() - started,
      status: null,
      ok: false,
      body: null,
      error: aborted ? `tiempo agotado (${timeoutMs} ms)` : error?.cause?.code || error?.message || 'error',
    };
  } finally {
    clearTimeout(timer);
  }
}

function criteriaCount(judgement) {
  const count = (area) => (area && typeof area === 'object' ? Object.values(area).filter((value) => Number.isFinite(value)).length : 0);
  return count(judgement?.coherencia) + count(judgement?.empatia);
}

async function probeModel({ model, full, timeoutMs, apiKey, maxTokensOption }) {
  const messages = full ? buildPrompt(reportInput()) : CONTRACT_MESSAGES;
  const maxTokens = full ? maxTokensOption : 64;
  const call = await callModel({ model, messages, maxTokens, timeoutMs, apiKey });
  const usage = call.body?.usage || {};
  const choice = call.body?.choices?.[0];
  const finish = choice?.finish_reason ?? null;
  const base = {
    model,
    status: call.status,
    ms: call.ms,
    finish,
    tokens: { in: usage.prompt_tokens ?? null, out: usage.completion_tokens ?? null },
  };

  if (!call.ok) {
    return { ...base, ok: false, reason: call.error || `HTTP ${call.status}` };
  }
  if (!full) {
    return { ...base, ok: finish === 'stop', reason: finish === 'stop' ? 'contrato OK' : `finish=${finish}` };
  }
  if (finish === 'length') return { ...base, ok: false, reason: 'respuesta incompleta (límite de tokens)' };
  let judgement;
  try {
    judgement = extractJson(choice?.message?.content || '');
  } catch (error) {
    return { ...base, ok: false, reason: `sin JSON utilizable (${error.message})` };
  }
  try {
    const validated = validateJudgement(judgement, reportInput().cfg);
    return { ...base, ok: true, reason: 'informe completo y válido', criteria: criteriaCount(validated.judgement) };
  } catch (error) {
    return { ...base, ok: false, reason: error.message, issues: (error.issues || []).slice(0, 4) };
  }
}

async function main() {
  const args = process.argv.slice(2);
  const full = args.includes('--full');
  const modelsArg = args.includes('--models') ? args[args.indexOf('--models') + 1] : null;
  const timeoutArg = args.includes('--timeout-ms') ? Number(args[args.indexOf('--timeout-ms') + 1]) : 120000;
  const maxTokensArg = args.includes('--max-tokens') ? Number(args[args.indexOf('--max-tokens') + 1]) : 4000;
  const models = modelsArg ? modelsArg.split(',').map((item) => item.trim()).filter(Boolean) : CANDIDATOS;
  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey) {
    console.error('Falta NVIDIA_API_KEY (backend/.env.local).');
    process.exit(2);
  }

  console.log(
    `SONDA REAL (${full ? `informe completo, max_tokens=${maxTokensArg}` : 'contrato, max_tokens=64'}) · ${models.length} modelos · límite ${timeoutArg} ms`,
  );
  console.log('Consume créditos del proveedor: es una prueba manual, no forma parte de la suite.');

  const results = [];
  for (const model of models) {
    const result = await probeModel({ model, full, timeoutMs: timeoutArg, apiKey, maxTokensOption: maxTokensArg });
    results.push(result);
    console.log(
      `${result.ok ? 'OK   ' : 'FALLA'} ${model} · ${result.ms} ms · status=${result.status ?? '-'} · finish=${result.finish ?? '-'} · ` +
        `tokens=${result.tokens.in ?? '?'}/${result.tokens.out ?? '?'} · ${result.reason}` +
        (result.criteria ? ` · criterios=${result.criteria}` : ''),
    );
  }

  const ok = results.filter((item) => item.ok).map((item) => item.model);
  const tokensIn = results.reduce((sum, item) => sum + (item.tokens.in || 0), 0);
  const tokensOut = results.reduce((sum, item) => sum + (item.tokens.out || 0), 0);
  console.log('\nRESUMEN');
  console.log('aptos:', ok.length ? ok.join(', ') : '(ninguno)');
  console.log(`tokens consumidos por la sonda: entrada ${tokensIn}, salida ${tokensOut}`);
}

main().catch((error) => {
  console.error('la sonda falló:', error?.message);
  process.exit(1);
});
