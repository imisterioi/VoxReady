// Laboratorio de transcripción: métricas de comparación entre una transcripción y un guion.
//
// Módulo PURO (sin React, sin red, sin dependencias): se prueba con `node --test`.
//
// Notas de interpretación (para no engañar a quien lea los resultados):
//  - El WER mide ERRORES DE EDICIÓN (sustituciones, omisiones e inserciones), no "calidad"
//    en sentido amplio: una transcripción con WER bajo puede perder matices (muletillas,
//    repeticiones) que sí importan para evaluar a un vocero.
//  - El WER puede SUPERAR el 100 % (cuando hay más errores que palabras en el guion).
//  - El texto ORIGINAL nunca se altera: la normalización solo se usa para calcular.
//  - Nunca se eliminan muletillas ni repeticiones del texto original.

// ---------------------------------------------------------------- Normalización

// Por defecto se igualan mayúsculas/minúsculas y se quita puntuación, pero se CONSERVAN
// los acentos (quitarlos ocultaría errores reales de reconocimiento).
export const DEFAULT_NORMALIZATION = {
  lowercase: true,
  stripPunctuation: true,
  collapseWhitespace: true,
  stripAccents: false,
};

// Se sustituye la puntuación y los símbolos por espacio (categorías Unicode P y S)
const PUNCTUATION_RE = /[\p{P}\p{S}]/gu;
// Solo letras (incluidas acentuadas), números y espacios
const KEEP_RE = /[^\p{L}\p{N}\s]/gu;

export function normalizeText(text, options = {}) {
  const opts = { ...DEFAULT_NORMALIZATION, ...options };
  let out = String(text ?? '');
  if (opts.stripPunctuation) out = out.replace(PUNCTUATION_RE, ' ').replace(KEEP_RE, ' ');
  if (opts.stripAccents) out = out.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (opts.lowercase) out = out.toLowerCase();
  if (opts.collapseWhitespace) out = out.replace(/\s+/g, ' ');
  return out.trim();
}

export function tokenize(text, options = {}) {
  const normalized = normalizeText(text, options);
  return normalized ? normalized.split(' ').filter(Boolean) : [];
}

// ---------------------------------------------------------------- Palabras vacías

// Lista breve de palabras funcionales del español: sirve para proponer palabras clave
// del guion cuando el usuario no las escribe a mano.
const STOPWORDS = new Set([
  'a', 'al', 'algo', 'algunas', 'algunos', 'ante', 'antes', 'como', 'con', 'contra', 'cual',
  'cuando', 'de', 'del', 'desde', 'donde', 'dos', 'el', 'ella', 'ellas', 'ellos', 'en', 'entre',
  'era', 'es', 'esa', 'ese', 'eso', 'esta', 'estamos', 'este', 'esto', 'estos', 'fue', 'ha',
  'han', 'hasta', 'hay', 'la', 'las', 'le', 'les', 'lo', 'los', 'mas', 'me', 'mi', 'mucho',
  'muy', 'no', 'nos', 'o', 'otra', 'otro', 'para', 'pero', 'poco', 'por', 'porque', 'que',
  'quien', 'se', 'ser', 'si', 'sin', 'sobre', 'son', 'su', 'sus', 'tal', 'tambien', 'tan',
  'tanto', 'te', 'tiene', 'todo', 'todos', 'tu', 'un', 'una', 'uno', 'unos', 'y', 'ya', 'yo',
]);

export const SPANISH_STOPWORDS = STOPWORDS;

// Palabras "significativas" del guion, en orden de aparición y sin repetir.
export function extractKeywords(reference, { limit = 15, minLength = 4, options } = {}) {
  const tokens = tokenize(reference, options);
  const seen = new Set();
  const out = [];
  for (const token of tokens) {
    if (token.length < minLength) continue;
    if (STOPWORDS.has(token)) continue;
    if (seen.has(token)) continue;
    seen.add(token);
    out.push(token);
    if (out.length >= limit) break;
  }
  return out;
}

// ---------------------------------------------------------------- Distancia de edición

// Levenshtein con retroceso: devuelve la distancia y el detalle de operaciones.
// Los empates se resuelven a favor de la diagonal (sustitución), convención habitual del WER.
export function editOperations(referenceTokens, hypothesisTokens) {
  const a = Array.isArray(referenceTokens) ? referenceTokens : [];
  const b = Array.isArray(hypothesisTokens) ? hypothesisTokens : [];
  const m = a.length;
  const n = b.length;

  const d = [];
  for (let i = 0; i <= m; i += 1) {
    d.push(new Int32Array(n + 1));
    d[i][0] = i;
  }
  for (let j = 0; j <= n; j += 1) d[0][j] = j;

  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
    }
  }

  const ops = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    const same = i > 0 && j > 0 && a[i - 1] === b[j - 1];
    if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + (same ? 0 : 1)) {
      ops.push({ type: same ? 'equal' : 'substitute', ref: a[i - 1], hyp: b[j - 1] });
      i -= 1;
      j -= 1;
    } else if (i > 0 && d[i][j] === d[i - 1][j] + 1) {
      ops.push({ type: 'delete', ref: a[i - 1], hyp: null });
      i -= 1;
    } else {
      ops.push({ type: 'insert', ref: null, hyp: b[j - 1] });
      j -= 1;
    }
  }
  ops.reverse();

  const counts = { equal: 0, substitute: 0, delete: 0, insert: 0 };
  for (const op of ops) counts[op.type] += 1;

  return { distance: d[m][n], counts, ops, referenceLength: m, hypothesisLength: n };
}

// Diferencia legible entre dos textos (operaciones sobre palabras normalizadas).
export function diffWords(reference, hypothesis, options = {}) {
  const { ops } = editOperations(tokenize(reference, options), tokenize(hypothesis, options));
  return ops;
}

// ---------------------------------------------------------------- WER y CER

// WER = (S + D + I) / N_palabras_del_guion.  Puede superar 1 (100 %).
export function wordErrorReport(reference, hypothesis, options = {}) {
  const refTokens = tokenize(reference, options);
  const hypTokens = tokenize(hypothesis, options);
  const { counts, ops, distance } = editOperations(refTokens, hypTokens);
  const referenceWords = refTokens.length;
  const errors = counts.substitute + counts.delete + counts.insert;
  return {
    substitutions: counts.substitute,
    deletions: counts.delete,
    insertions: counts.insert,
    hits: counts.equal,
    errors,
    distance,
    referenceWords,
    hypothesisWords: hypTokens.length,
    // null cuando no se puede medir (guion sin palabras): no se inventa un 0.
    wer: referenceWords > 0 ? errors / referenceWords : null,
    ops,
  };
}

// CER = distancia de edición por carácter / caracteres del guion (sin espacios). Puede superar 1.
export function characterErrorReport(reference, hypothesis, options = {}) {
  const refChars = Array.from(normalizeText(reference, options).replace(/\s+/g, ''));
  const hypChars = Array.from(normalizeText(hypothesis, options).replace(/\s+/g, ''));
  const { counts, distance } = editOperations(refChars, hypChars);
  const referenceChars = refChars.length;
  const errors = counts.substitute + counts.delete + counts.insert;
  return {
    substitutions: counts.substitute,
    deletions: counts.delete,
    insertions: counts.insert,
    errors,
    distance,
    referenceChars,
    hypothesisChars: hypChars.length,
    cer: referenceChars > 0 ? errors / referenceChars : null,
  };
}


// ---------------------------------------------------------------- Palabras clave

// Para cada palabra clave del guion indica si el motor la reprodujo igual, la cambió o la omitió.
export function keywordCoverage(keywords, hypothesis, options = {}) {
  const hypTokens = tokenize(hypothesis, options);
  const hypSet = new Set(hypTokens);
  return (keywords || []).map((keyword) => {
    const key = normalizeText(keyword, options);
    if (!key) return { keyword, status: 'vacia', match: null, distance: null };
    if (hypSet.has(key)) return { keyword, status: 'presente', match: key, distance: 0 };
    // ¿Aparece una palabra parecida? (menor distancia de edición sobre caracteres)
    let best = null;
    for (const token of hypTokens) {
      const dist = editOperations(Array.from(key), Array.from(token)).distance;
      if (best == null || dist < best.distance) best = { token, distance: dist };
    }
    const threshold = Math.max(1, Math.round(key.length * 0.34));
    if (best && best.distance <= threshold) {
      return { keyword, status: 'cambiada', match: best.token, distance: best.distance };
    }
    return { keyword, status: 'omitida', match: best?.token ?? null, distance: best?.distance ?? null };
  });
}

// ---------------------------------------------------------------- Comparación completa

// Compara UN motor contra el guion y devuelve todo lo que se muestra y se guarda.
export function compareWithReference(reference, hypothesis, { keywords, options, engine, meta } = {}) {
  const original = String(hypothesis ?? '');
  const empty = !normalizeText(original, options);
  const word = wordErrorReport(reference, original, options);
  const char = characterErrorReport(reference, original, options);
  const keys = Array.isArray(keywords) && keywords.length ? keywords : extractKeywords(reference, { options });
  return {
    engine: engine || 'desconocido',
    meta: meta || {},
    hypothesisOriginal: original, // se conserva el texto tal cual, con muletillas y repeticiones
    hypothesisEmpty: empty,
    word,
    char,
    keywords: keywordCoverage(keys, original, options),
    options: { ...DEFAULT_NORMALIZATION, ...options },
  };
}

// Diferencia entre dos transcripciones (por ejemplo Web Speech API vs Whisper).
export function compareEngines(referenceText, hypothesisText, options = {}) {
  return { ops: diffWords(referenceText, hypothesisText, options) };
}

export function formatPercent(value) {
  if (value == null || Number.isNaN(value)) return 'no medible';
  return `${(value * 100).toFixed(1)} %`;
}


// ---------------------------------------------------------------- Registro y exportación

export const LAB_STORAGE_KEY = 'voxready_lab_transcription_runs_v1';
export const LAB_STORAGE_LIMIT = 100;

// Construye el registro de una ejecución. No guarda audio ni credenciales.
export function buildRunRecord({
  reference,
  engines,
  audio = {},
  whisperConfig = {},
  warnings = [],
  status = 'ok',
  startedAt = null,
  finishedAt = null,
  notes = '',
} = {}) {
  const cleanEngines = {};
  for (const [key, value] of Object.entries(engines || {})) {
    // Las métricas pueden venir planas (wer, cer...) o dentro de `word`/`char`, que es lo
    // que devuelven las funciones de comparación. Se aceptan ambas formas para no perder
    // el WER ni el CER en el historial y en la exportación.
    const word = value?.word || null;
    const char = value?.char || null;
    cleanEngines[key] = value
      ? {
          engineId: value.engineId ?? null,
          status: value.status ?? 'ok',
          text: value.text ?? '',
          textOriginal: value.textOriginal ?? value.text ?? '',
          wer: value.wer ?? word?.wer ?? null,
          cer: value.cer ?? char?.cer ?? null,
          substitutions: value.substitutions ?? word?.substitutions ?? null,
          deletions: value.deletions ?? word?.deletions ?? null,
          insertions: value.insertions ?? word?.insertions ?? null,
          keywords: value.keywords ?? [],
          processingMs: value.processingMs ?? null,
          loadMs: value.loadMs ?? null,
          totalMs: value.totalMs ?? null,
          rtf: value.rtf ?? null,
          model: value.model ?? null,
          device: value.device ?? null,
          provider: value.provider ?? null,
          remote: value.remote ?? null,
          config: value.config ?? null,
          error: value.error ?? null,
        }
      : null;
  }
  return {
    id: `lab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    startedAt,
    finishedAt,
    status,
    reference: String(reference ?? ''),
    engines: cleanEngines,
    audio,
    whisperConfig,
    warnings,
    notes,
    normalization: { ...DEFAULT_NORMALIZATION },
  };
}

export function toJSON(runs) {
  return JSON.stringify({ exportedAt: new Date().toISOString(), runs: runs || [] }, null, 2);
}

function csvCell(value) {
  if (value == null) return '';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return `"${text.replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;
}

export function toCSV(runs) {
  // Se conservan las columnas de siempre en el mismo orden (compatibilidad con las
  // exportaciones anteriores) y se añaden al final las de Whisper Small y el resumen de
  // motores usados en la ejecución.
  const header = [
    'id', 'fecha', 'estado', 'guion', 'duracion_audio_s',
    'webspeech_texto', 'webspeech_wer', 'webspeech_s', 'webspeech_d', 'webspeech_i',
    'webspeech_cer', 'webspeech_ms',
    'whisper_texto', 'whisper_wer', 'whisper_s', 'whisper_d', 'whisper_i',
    'whisper_cer', 'whisper_proceso_ms', 'whisper_total_ms', 'whisper_modelo', 'whisper_config',
    'advertencias',
    'whisper_small_texto', 'whisper_small_wer', 'whisper_small_s', 'whisper_small_d',
    'whisper_small_i', 'whisper_small_cer', 'whisper_small_proceso_ms', 'whisper_small_carga_ms',
    'whisper_small_modelo',
    'whisper_medium_texto', 'whisper_medium_wer', 'whisper_medium_s', 'whisper_medium_d',
    'whisper_medium_i', 'whisper_medium_cer', 'whisper_medium_proceso_ms', 'whisper_medium_carga_ms',
    'whisper_medium_modelo',
    'motores',
  ];
  const lines = [header.join(',')];
  for (const run of runs || []) {
    const ws = run.engines?.webspeech || {};
    const wh = run.engines?.whisper || {};
    const sm = run.engines?.whisper_small || {};
    const md = run.engines?.whisper_medium || {};
    const used = Object.entries(run.engines || {})
      .filter(([, value]) => value)
      .map(([key, value]) => `${key}:${value.status || 'ok'}`)
      .join(' | ');
    lines.push(
      [
        run.id, run.createdAt, run.status, run.reference, run.audio?.durationSeconds,
        ws.text, ws.wer, ws.substitutions, ws.deletions, ws.insertions, ws.cer, ws.totalMs,
        wh.text, wh.wer, wh.substitutions, wh.deletions, wh.insertions, wh.cer,
        wh.processingMs, wh.totalMs, wh.model, wh.config,
        (run.warnings || []).join(' | '),
        sm.text, sm.wer, sm.substitutions, sm.deletions, sm.insertions, sm.cer,
        sm.processingMs, sm.loadMs, sm.model,
        md.text, md.wer, md.substitutions, md.deletions, md.insertions, md.cer,
        md.processingMs, md.loadMs, md.model,
        used,
      ]
        .map(csvCell)
        .join(','),
    );
  }
  return lines.join('\n');
}


// ---------------------------------------------------------------- Historial local (navegador)

// El historial vive SOLO en el navegador. Nunca guarda el token ni credenciales.
export function loadRuns() {
  if (typeof window === 'undefined' || !window.localStorage) return [];
  try {
    const raw = window.localStorage.getItem(LAB_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveRun(run) {
  if (typeof window === 'undefined' || !window.localStorage) return [];
  const runs = [run, ...loadRuns()].slice(0, LAB_STORAGE_LIMIT);
  window.localStorage.setItem(LAB_STORAGE_KEY, JSON.stringify(runs));
  return runs;
}

export function removeRun(id) {
  if (typeof window === 'undefined' || !window.localStorage) return [];
  const runs = loadRuns().filter((r) => r.id !== id);
  window.localStorage.setItem(LAB_STORAGE_KEY, JSON.stringify(runs));
  return runs;
}

export function clearRuns() {
  if (typeof window === 'undefined' || !window.localStorage) return;
  window.localStorage.removeItem(LAB_STORAGE_KEY);
}

// ---------------------------------------------------------------- Guion de ejemplo

// Ejemplo genérico de práctica de vocería. NO corresponde a ninguna organización real
// ni contiene datos personales: solo sirve para probar el comparador.
export const EXAMPLE_SCRIPT = [
  'Quiero partir lamentando profundamente lo ocurrido y expresar nuestra solidaridad con la familia afectada.',
  'Estamos colaborando con la autoridad desde el primer minuto y hemos abierto una investigación interna.',
  'Como empresa asumimos la responsabilidad que nos corresponde y vamos a entregar toda la información disponible.',
  'No vamos a especular sobre las causas mientras la investigación esté en curso.',
  'Nuestro compromiso es informar con transparencia y responder todas las preguntas en la próxima actualización.',
].join(' ');

