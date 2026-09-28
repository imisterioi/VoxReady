// Evaluador IA: analiza la entrevista completa y genera el informe tipo coach.
//
// El puntaje de cada área se calcula con el patrón de evaluación aplicable
// (patrón excepcional del escenario, o el patrón activo):
//  - Tono de voz  → reglas sobre métricas medidas (criterios, pesos y rangos del patrón).
//  - Expresión    → reglas sobre métricas corporales (MediaPipe).
//  - Coherencia   → IA evaluadora, criterio por criterio, guiada por los descriptores del patrón.
//  - Empatía      → IA evaluadora + conexión visual con la cámara (% configurable).
//
// Configuración en backend/.env.local:
//   AI_EVAL_MODEL=moonshotai/kimi-k3
//   AI_EVAL_FALLBACK_MODEL=nvidia/nemotron-3-super-120b-a12b
const { parseList } = require('./interviewer');
const { resolveConfig } = require('./patternConfig');

const BASE_URL = 'https://integrate.api.nvidia.com/v1';
const DEFAULT_EVAL_MODEL = 'moonshotai/kimi-k3';
const DEFAULT_EVAL_FALLBACK = 'nvidia/nemotron-3-super-120b-a12b';
const DEFAULT_EVAL_BACKUP = 'google/gemma-4-31b-it'; // tercer respaldo

const clamp = (v, min = 0, max = 100) => Math.max(min, Math.min(max, v));
const round = (v) => (v == null || Number.isNaN(v) ? null : Math.round(v));
const num = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

// Puntaje 100 dentro del rango ideal y decae linealmente fuera de él
function rangeScore(value, idealMin, idealMax, zeroBelow, zeroAbove) {
  if (value == null || Number.isNaN(value)) return null;
  if (value >= idealMin && value <= idealMax) return 100;
  if (value < idealMin) return clamp(((value - zeroBelow) / Math.max(idealMin - zeroBelow, 1e-9)) * 100);
  return clamp(((zeroAbove - value) / Math.max(zeroAbove - idealMax, 1e-9)) * 100);
}

const average = (items) => {
  const valid = items.filter((i) => i.score != null && i.weight > 0);
  const total = valid.reduce((s, i) => s + i.weight, 0);
  return total ? valid.reduce((s, i) => s + i.score * i.weight, 0) / total : null;
};

// ------------------------------------------------------ Tono de voz (reglas)

function scoreVoice(voice = {}, cfg) {
  if (!voice.available) return { score: null, details: [] };
  const c = cfg.voice.criteria;

  const wpmMin = num(c.wpm.idealMin, 120);
  const wpmMax = num(c.wpm.idealMax, 165);
  const fillerTol = num(c.fillers.tolerancePerMin, 2);
  const pauseTol = num(c.pauses.tolerancePerAnswer, 1);
  const varMin = num(c.variation.idealMin, 35) / 100;
  const varMax = num(c.variation.idealMax, 90) / 100;
  const latMax = num(c.latency.idealMaxSec, 2.5) * 1000;

  const details = [
    { key: 'wpm', label: c.wpm.label, value: round(voice.wpm), unit: 'palabras/min', weight: num(c.wpm.weight, 0), score: rangeScore(voice.wpm, wpmMin, wpmMax, wpmMin * 0.5, wpmMax * 1.4) },
    {
      key: 'fillers',
      label: c.fillers.label,
      value: voice.fillersPerMin != null ? Number(voice.fillersPerMin.toFixed(1)) : null,
      unit: 'por minuto',
      weight: num(c.fillers.weight, 0),
      score: voice.fillersPerMin == null ? null : clamp(100 - Math.max(0, voice.fillersPerMin - fillerTol) * 12),
    },
    {
      key: 'pauses',
      label: c.pauses.label,
      value: voice.longPauses,
      unit: 'en total',
      weight: num(c.pauses.weight, 0),
      score: voice.longPausesPerAnswer == null ? null : clamp(100 - Math.max(0, voice.longPausesPerAnswer - pauseTol) * 20),
    },
    {
      key: 'variation',
      label: c.variation.label,
      value: voice.volumeVariation != null ? round(voice.volumeVariation * 100) : null,
      unit: '%',
      weight: num(c.variation.weight, 0),
      score: rangeScore(voice.volumeVariation, varMin, varMax, varMin * 0.3, varMax * 1.7),
    },
    {
      key: 'latency',
      label: c.latency.label,
      value: voice.avgLatencyMs != null ? Number((voice.avgLatencyMs / 1000).toFixed(1)) : null,
      unit: 's',
      weight: num(c.latency.weight, 0),
      score: rangeScore(voice.avgLatencyMs, 300, latMax, 0, latMax * 3),
    },
  ];
  return { score: round(average(details)), details };
}

// ------------------------------------------------ Expresión corporal (reglas)

function scoreBody(body = {}, cfg) {
  if (!body.available) return { score: null, details: [] };
  const c = cfg.expression.criteria;
  const presenceMin = num(c.presence.idealMinPct, 90) / 100;
  const facingMin = num(c.facing.idealMinPct, 75) / 100;
  const tiltMax = num(c.posture.idealMaxDeg, 4);

  const details = [
    { key: 'presence', label: c.presence.label, value: round(body.presence * 100), unit: '%', weight: num(c.presence.weight, 0), score: rangeScore(body.presence, presenceMin, 1, presenceMin * 0.3, 2) },
    { key: 'facing', label: c.facing.label, value: round(body.facingCamera * 100), unit: '%', weight: num(c.facing.weight, 0), score: rangeScore(body.facingCamera, facingMin, 1, facingMin * 0.25, 2) },
    { key: 'posture', label: c.posture.label, value: body.shoulderTilt != null ? Number(body.shoulderTilt.toFixed(1)) : null, unit: '°', weight: num(c.posture.weight, 0), score: rangeScore(body.shoulderTilt, 0, tiltMax, 0, tiltMax * 4) },
    { key: 'head', label: c.head.label, value: body.headMovement != null ? Number((body.headMovement * 1000).toFixed(1)) : null, unit: 'mov.', weight: num(c.head.weight, 0), score: rangeScore(body.headMovement, 0.001, 0.006, 0, 0.02) },
    { key: 'hands', label: c.hands.label, value: body.handActivity != null ? Number((body.handActivity * 1000).toFixed(1)) : null, unit: 'mov.', weight: num(c.hands.weight, 0), score: rangeScore(body.handActivity, 0.002, 0.012, 0, 0.035) },
  ];
  return { score: round(average(details)), details };
}

// ------------------------------------------------------ IA (contenido)

const STRICTNESS = {
  flexible: 'Sé comprensivo: valora los intentos y el progreso, penaliza solo los errores graves.',
  normal: 'Sé exigente pero constructivo.',
  exigente: 'Sé muy exigente, como un editor de noticias en una crisis real: cualquier evasiva o imprecisión baja el puntaje.',
};

function criteriaText(area) {
  return Object.entries(area.criteria)
    .filter(([, c]) => num(c.weight, 0) > 0)
    .map(([key, c]) => `    "${key}": <0-100>  // ${c.label} (peso ${c.weight})`)
    .join(',\n');
}

function buildPrompt({ theme, transcript, voice, body, lighting, cfg }) {
  const keyMessages = parseList(theme.keyMessages);
  const redLines = parseList(theme.redLines);

  const conversation = transcript
    .map((t, i) => {
      const extra = t.metrics
        ? ` [${t.metrics.wpm ? `${Math.round(t.metrics.wpm)} pal/min, ` : ''}${t.metrics.fillers ?? 0} muletillas${t.metrics.latencyMs != null ? `, tardó ${(t.metrics.latencyMs / 1000).toFixed(1)} s en empezar` : ''}]`
        : '';
      return `P${i + 1} (periodista): ${t.question}\nR${i + 1} (vocero): ${t.answer?.trim() || '(no respondió)'}${extra}`;
    })
    .join('\n\n');

  const measured = [
    voice?.available
      ? `Voz: ${Math.round(voice.wpm || 0)} palabras/min, ${voice.fillersPerMin?.toFixed(1)} muletillas/min (${(voice.fillerWords || []).join(', ') || 'ninguna'}), ${voice.longPauses} pausas largas, variación de volumen ${Math.round((voice.volumeVariation || 0) * 100)}%.`
      : 'Voz: no se pudo medir.',
    body?.available
      ? `Cuerpo: mirada a cámara ${Math.round(body.facingCamera * 100)}% del tiempo, presencia ${Math.round(body.presence * 100)}%, inclinación de hombros ${body.shoulderTilt?.toFixed(1)}°, movimiento de cabeza ${body.headMovement > 0.006 ? 'alto (nervioso)' : body.headMovement < 0.001 ? 'muy bajo (rígido)' : 'adecuado'}, gestos de manos ${body.handActivity > 0.012 ? 'excesivos' : body.handActivity < 0.002 ? 'casi nulos' : 'moderados'}.`
      : 'Cuerpo: no se pudo medir (sin cámara).',
    lighting?.average != null ? `Iluminación promedio: ${Math.round(lighting.average)}/255.` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const system =
    'Eres un coach experto en vocería y comunicación de crisis. Evalúas entrevistas simuladas de voceros corporativos en español de Chile. ' +
    `${STRICTNESS[cfg.strictness] || STRICTNESS.normal} ` +
    'Háblale directamente al vocero en segunda persona (tú): "mostraste", "dijiste", nunca "el vocero mostró". ' +
    'Responde ÚNICAMENTE con un objeto JSON válido, sin texto antes ni después, sin bloques de código.';

  const user = `Escenario: ${theme.title}
Contexto: ${theme.context}
Óptica institucional esperada: ${theme.optic || 'no definida'}
Mensajes clave que debía sostener:
${keyMessages.map((m, i) => `${i + 1}. ${m}`).join('\n') || '(no definidos)'}
Líneas rojas (no debía decir):
${redLines.map((m, i) => `${i + 1}. ${m}`).join('\n') || '(no definidas)'}

Entrevista:
${conversation}

Métricas medidas automáticamente:
${measured}

Estándar de evaluación (patrón maestro):
- Coherencia: ${cfg.coherence.descriptor}
- Empatía: ${cfg.empathy.descriptor}

Devuelve este JSON (puntajes enteros 0-100, textos en español, tuteando al vocero;
dentro de los textos usa comillas simples ' en vez de comillas dobles):
{
  "coherencia": {
${criteriaText(cfg.coherence)}
  },
  "empatia": {
${criteriaText(cfg.empathy)}
  },
  "resumen": "<2 frases con la evaluación general>",
  "cita": "<una observación de coach que cruce lo que dijo con cómo lo dijo, usando las métricas>",
  "fortalezas": ["<3 cosas concretas que hizo bien>"],
  "mejoras": ["<3 acciones concretas para mejorar>"],
  "mensajesClave": [{"mensaje": "<mensaje clave>", "cubierto": true|false}],
  "lineasRojas": [{"linea": "<línea roja>", "cruzada": true|false, "evidencia": "<frase del vocero o vacío>"}],
  "porPregunta": [{"pregunta": <número>, "puntaje": <0-100>, "comentario": "<1 frase>"}]
}`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

// Puntaje de un área evaluada por la IA, ponderando sus criterios
function scoreFromCriteria(area, judged) {
  if (typeof judged === 'number') return { score: clamp(judged), details: [] };
  const details = Object.entries(area.criteria)
    .filter(([, c]) => num(c.weight, 0) > 0)
    .map(([key, c]) => ({
      key,
      label: c.label,
      value: judged?.[key] != null ? round(clamp(Number(judged[key]))) : null,
      unit: '/100',
      weight: num(c.weight, 0),
      score: judged?.[key] != null ? clamp(Number(judged[key])) : null,
    }));
  return { score: average(details), details };
}

function extractJson(text) {
  const clean = text.replace(/```(?:json)?/gi, '');
  const start = clean.indexOf('{');
  const end = clean.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('La respuesta no contiene JSON');
  const raw = clean.slice(start, end + 1);
  try {
    return JSON.parse(raw);
  } catch {
    // Reparación simple: comas sobrantes antes de ] o }
    return JSON.parse(raw.replace(/,\s*([}\]])/g, '$1'));
  }
}

async function callEvaluator(model, messages, timeoutMs, raceSignal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      signal: AbortSignal.any([controller.signal, raceSignal]),
      headers: { Authorization: `Bearer ${process.env.NVIDIA_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.3,
        max_tokens: 4000,
        response_format: { type: 'json_object' }, // obliga a responder JSON válido
      }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const choice = data.choices?.[0];
    if (choice?.finish_reason === 'length') throw new Error('respuesta incompleta (límite de tokens)');
    const judgement = extractJson(choice?.message?.content || '');
    if (judgement.coherencia == null || judgement.empatia == null) throw new Error('JSON sin puntajes');
    return judgement;
  } finally {
    clearTimeout(timer);
  }
}

// Consulta varios modelos en paralelo y usa el primero que entregue un JSON válido
async function judgeContent(input) {
  const messages = buildPrompt(input);
  const timeoutMs = Number(process.env.AI_EVAL_TIMEOUT_MS) || 90000;
  const models = [
    ...new Set([
      process.env.AI_EVAL_MODEL || DEFAULT_EVAL_MODEL,
      process.env.AI_EVAL_FALLBACK_MODEL || DEFAULT_EVAL_FALLBACK,
      DEFAULT_EVAL_BACKUP,
    ]),
  ];
  const start = Date.now();
  const race = new AbortController();

  try {
    const winner = await Promise.any(
      models.map((model) =>
        callEvaluator(model, messages, timeoutMs, race.signal)
          .then((judgement) => ({ judgement, model, ms: Date.now() - start }))
          .catch((error) => {
            if (!race.signal.aborted) {
              console.warn(`[IA evaluadora] ${model} falló: ${error.name === 'AbortError' ? 'tiempo agotado' : error.message}`);
            }
            throw error;
          }),
      ),
    );
    race.abort(); // cancela las evaluaciones que siguen pendientes
    return winner;
  } catch {
    throw new Error('La IA evaluadora no respondió. Intenta nuevamente.');
  }
}

// ------------------------------------------------------ Informe completo

async function evaluateSession({ theme, transcript, metrics, pattern, patternSource = 'active' }) {
  if (!process.env.NVIDIA_API_KEY) {
    const error = new Error('Falta NVIDIA_API_KEY en backend/.env.local');
    error.code = 'NO_API_KEY';
    throw error;
  }

  const cfg = resolveConfig(pattern);
  const voice = scoreVoice(metrics?.voice, cfg);
  const body = scoreBody(metrics?.body, cfg);
  const { judgement, model, ms } = await judgeContent({
    theme,
    transcript,
    voice: metrics?.voice,
    body: metrics?.body,
    lighting: metrics?.lighting,
    cfg,
  });

  const coherence = scoreFromCriteria(cfg.coherence, judgement.coherencia);
  const empathyContent = scoreFromCriteria(cfg.empathy, judgement.empatia);

  // La conexión visual (mirar a la cámara) aporta un % configurable de la empatía
  const visualShare = clamp(num(cfg.empathy.visualWeight, 20)) / 100;
  const facingMin = num(cfg.expression.criteria.facing.idealMinPct, 75) / 100;
  const facing = metrics?.body?.available ? rangeScore(metrics.body.facingCamera, facingMin, 1, facingMin * 0.25, 2) : null;
  const empathy =
    empathyContent.score == null ? null : facing == null ? empathyContent.score : empathyContent.score * (1 - visualShare) + facing * visualShare;

  const weights = {
    expression: num(cfg.areas.expression, 25),
    voice: num(cfg.areas.voice, 25),
    coherence: num(cfg.areas.coherence, 30),
    empathy: num(cfg.areas.empathy, 20),
  };

  const areas = [
    { key: 'expression', label: 'Expresión', score: body.score, weight: weights.expression, details: body.details, source: 'Cámara (MediaPipe)' },
    { key: 'voice', label: 'Tono de voz', score: voice.score, weight: weights.voice, details: voice.details, source: 'Micrófono' },
    { key: 'coherence', label: 'Coherencia', score: round(coherence.score), weight: weights.coherence, details: coherence.details, source: 'IA evaluadora' },
    {
      key: 'empathy',
      label: 'Empatía',
      score: round(empathy),
      weight: weights.empathy,
      details: empathyContent.details,
      source: facing == null ? 'IA evaluadora' : `IA evaluadora + mirada (${Math.round(visualShare * 100)}%)`,
    },
  ];

  // Si un área no se pudo medir (sin cámara/micrófono), su peso se reparte entre las demás
  const global = round(average(areas));

  return {
    global,
    areas,
    weights,
    pattern: pattern ? { id: pattern.id, version: pattern.version, name: pattern.name || null, source: patternSource } : null,
    patternVersion: pattern?.version ?? null,
    strictness: cfg.strictness,
    resumen: judgement.resumen || '',
    cita: judgement.cita || '',
    fortalezas: (judgement.fortalezas || []).slice(0, 4),
    mejoras: (judgement.mejoras || []).slice(0, 4),
    mensajesClave: judgement.mensajesClave || [],
    lineasRojas: judgement.lineasRojas || [],
    porPregunta: judgement.porPregunta || [],
    measured: { voice: metrics?.voice || null, body: metrics?.body || null, lighting: metrics?.lighting || null },
    ai: { evaluator: model, ms },
    generatedAt: new Date().toISOString(),
  };
}

module.exports = { evaluateSession };
