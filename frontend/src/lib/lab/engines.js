// Catálogo de motores del Laboratorio de transcripción y utilidades para compararlos.
//
// Módulo PURO (sin React, sin red, sin dependencias): se prueba con `node --test`.
//
// Reglas del experimento (las mismas de siempre):
//  - Los motores trabajan sobre la MISMA grabación y el MISMO guion de referencia.
//  - Whisper Base y Whisper Small son cómputo LOCAL (faster-whisper en el servicio
//    FastAPI): el audio no sale del equipo.
//  - Speech API es el reconocimiento del navegador: escucha el micrófono en vivo y el
//    audio viaja al servicio del fabricante. No puede transcribir un archivo, y aquí no
//    se simula lo que esa API no ofrece.
//  - Terminar sin error NO significa que la transcripción sea correcta: por eso cada
//    resultado se compara con el guion cuando existe.

import { compareWithReference, normalizeText } from './transcription.js';

export const ENGINE_KINDS = {
  WHISPER: 'whisper',
  BROWSER_SPEECH: 'browser-speech',
};

// `storageKey` es la clave con la que cada motor se guarda en el historial. Se conservan
// `webspeech` y `whisper` para no romper los registros ni las exportaciones existentes.
export const ENGINES = [
  {
    id: 'whisper-small',
    label: 'Whisper Small (local)',
    short: 'Whisper Small',
    kind: ENGINE_KINDS.WHISPER,
    storageKey: 'whisper_small',
    modelKey: 'small',
    remote: false,
    provider: 'faster-whisper en el servicio local (sin envío a Internet)',
    icon: 'server',
    accent: 'bg-success/10 text-success',
    description:
      'Whisper Small en el servicio local: más preciso que Base y bastante más lento. La primera vez que se usa, el servicio carga el modelo (~460 MB de descarga si no está en caché).',
  },
  {
    id: 'whisper-base',
    label: 'Whisper Base (local)',
    short: 'Whisper Base',
    kind: ENGINE_KINDS.WHISPER,
    storageKey: 'whisper',
    modelKey: 'base',
    remote: false,
    provider: 'faster-whisper en el servicio local (sin envío a Internet)',
    icon: 'server',
    accent: 'bg-success/10 text-success',
    description:
      'Whisper Base en el servicio local: la implementación original del laboratorio (rápida, buen punto de partida).',
  },
  {
    id: 'whisper-medium',
    label: 'Whisper Medium (local)',
    short: 'Whisper Medium',
    kind: ENGINE_KINDS.WHISPER,
    storageKey: 'whisper_medium',
    modelKey: 'medium',
    remote: false,
    provider: 'faster-whisper en el servicio local (sin envío a Internet)',
    icon: 'server',
    accent: 'bg-success/10 text-success',
    description:
      'Whisper Medium en el servicio local: el más preciso de los tres y el más lento y pesado (≈1,5 GB de RAM en CPU int8). Se carga solo cuando se usa.',
  },
  {
    id: 'speech-api',
    label: 'Speech API (navegador)',
    short: 'Speech API',
    kind: ENGINE_KINDS.BROWSER_SPEECH,
    storageKey: 'webspeech',
    modelKey: null,
    remote: true,
    provider: 'Web Speech API del navegador: el audio se procesa en el servicio del fabricante',
    icon: 'mic',
    accent: 'bg-accent-soft text-accent-fg',
    description:
      'Reconocimiento de voz del navegador (Chrome/Edge), transcribe en vivo desde el micrófono. No puede transcribir un archivo y su tiempo incluye la red del fabricante.',
  },
];

export const DEFAULT_ENGINE_ID = 'whisper-base';

// Valor del selector que significa "procesa el mismo audio con todos los motores".
export const COMPARE_ALL_ID = 'compare-all';

// Orden de la comparación: primero los Whisper de menor a mayor coste (el servicio los
// atiende en serie y Base suele estar ya cargado), después Speech API, cuyo texto ya se
// capturó en vivo durante la grabación.
export const COMPARISON_ORDER = ['whisper-base', 'whisper-small', 'whisper-medium', 'speech-api'];

export function getEngine(id) {
  return ENGINES.find((engine) => engine.id === id) || null;
}

export function isEngineId(id) {
  return ENGINES.some((engine) => engine.id === id);
}

export function engineIds() {
  return ENGINES.map((engine) => engine.id);
}

export function comparisonIds() {
  return COMPARISON_ORDER.filter(isEngineId);
}

// Motores a ejecutar según lo elegido en el selector.
export function targetIdsFor(selection) {
  if (selection === COMPARE_ALL_ID) return comparisonIds();
  return isEngineId(selection) ? [selection] : [DEFAULT_ENGINE_ID];
}

export function describeSelection(selection) {
  if (selection === COMPARE_ALL_ID) {
    return `Se ejecutarán los ${comparisonIds().length} motores en serie sobre la misma grabación.`;
  }
  const engine = getEngine(selection) || getEngine(DEFAULT_ENGINE_ID);
  return engine.description;
}

// Speech API solo escucha el micrófono: no puede transcribir un archivo y aquí no se
// simula lo que esa API no ofrece. Los motores Whisper sí aceptan archivos.
export function supportsFileInput(engine) {
  return Boolean(engine) && engine.kind === ENGINE_KINDS.WHISPER;
}

// ---------------------------------------------------------------- métricas

// Métricas de una transcripción respecto del guion, con el MISMO procedimiento para
// todos los motores. Si no hay guion no se inventa un WER: se marca como no medible.
export function metricsFor(text, reference, options = {}) {
  const hasReference = Boolean(normalizeText(reference ?? '', options));
  const comparison = compareWithReference(reference ?? '', String(text ?? ''), { options });
  return {
    hasReference,
    hypothesisEmpty: comparison.hypothesisEmpty,
    textOriginal: comparison.hypothesisOriginal,
    word: hasReference ? comparison.word : null,
    char: hasReference ? comparison.char : null,
    keywords: hasReference ? comparison.keywords : [],
  };
}

// ---------------------------------------------------------------- resultados

function baseResult(engine, extra = {}) {
  return {
    engineId: engine.id,
    engineLabel: engine.label,
    engineShort: engine.short,
    kind: engine.kind,
    storageKey: engine.storageKey,
    modelKey: engine.modelKey,
    remote: engine.remote,
    local: !engine.remote,
    provider: engine.provider,
    status: 'idle',
    text: '',
    error: null,
    processingMs: null,
    loadMs: null,
    proxyMs: null,
    totalMs: null,
    rtf: null,
    durationSeconds: null,
    segments: null,
    model: null,
    config: null,
    ...extra,
  };
}

export function idleResult(engine, status = 'idle') {
  return baseResult(engine, { status });
}

export function failureResult(engine, message) {
  return baseResult(engine, {
    status: 'error',
    error: message ? String(message) : 'El motor falló sin detalle.',
  });
}

// Resultado definitivo a partir de lo que devolvió el transporte (proxy → servicio) o de
// un texto ya obtenido (Speech API en vivo durante la grabación).
export function finishResult(engine, draft = {}, { reference = '', options = {} } = {}) {
  const rawText = String(draft.text ?? '');
  const hasContent = Boolean(rawText.trim());
  // El texto literal se conserva; solo un texto hecho de espacios queda vacío, para no
  // mostrar una "transcripción" en blanco como si fuese un resultado.
  const text = hasContent ? rawText : '';
  const metrics = metricsFor(text, reference, options);
  const base = baseResult(engine, {
    ...draft,
    text,
    textOriginal: draft.textOriginal ?? rawText,
    ...metrics,
  });

  if (draft.status && draft.status !== 'ok') {
    // Un motor que falló no produjo transcripción: se conserva su error y NO se le
    // calculan métricas (comparar un texto que no existe induciría a error).
    return {
      ...base,
      status: draft.status === 'no_disponible' ? 'no_disponible' : 'error',
      word: null,
      char: null,
      keywords: [],
    };
  }
  if (!hasContent) {
    return {
      ...base,
      status: 'error',
      error:
        draft.error ||
        'El motor no devolvió texto (silencio, audio muy corto o idioma no reconocido).',
    };
  }
  return { ...base, status: 'ok', error: draft.error ?? null };
}

// Ejecuta los motores EN SERIE (uso secuencial de la CPU/GPU y trazas claras). Si uno
// falla, se registra su error y los demás continúan: ninguno arrastra a los otros.
export async function runEnginesSequentially(ids, runOne, { onResult } = {}) {
  const results = [];
  for (const id of ids) {
    const engine = getEngine(id);
    if (!engine) continue;
    let result;
    try {
      const value = await runOne(engine);
      result = value && value.engineId ? value : finishResult(engine, value || {});
    } catch (error) {
      result = failureResult(engine, error?.message);
    }
    results.push(result);
    if (typeof onResult === 'function') onResult(result, results.slice());
  }
  return results;
}

// ---------------------------------------------------------------- resumen

// Registro de motores con las claves del historial (`whisper`, `whisper_small`, `webspeech`).
export function enginesRecord(results) {
  const record = {};
  for (const result of results || []) {
    if (result && result.storageKey) record[result.storageKey] = result;
  }
  return record;
}

// Resumen de la comparación. No declara un ganador absoluto: solo señala el más rápido y
// el de menor WER (si se pudo calcular) y recuerda que completar no es acertar.
export function summarizeComparison(results) {
  const list = (results || []).filter(Boolean);
  const withTime = list.filter((r) => r.status === 'ok' && Number.isFinite(r.processingMs));
  const withWer = list.filter((r) => r.status === 'ok' && r.word && Number.isFinite(r.word.wer));

  const pickMin = (items, valueOf) =>
    items.length ? items.reduce((best, item) => (valueOf(item) < valueOf(best) ? item : best)) : null;

  const fastest = pickMin(withTime, (r) => r.processingMs);
  const bestWer = pickMin(withWer, (r) => r.word.wer);

  return {
    total: list.length,
    ok: list.filter((r) => r.status === 'ok').length,
    failed: list.filter((r) => r.status === 'error').length,
    unavailable: list.filter((r) => r.status === 'no_disponible').length,
    metricsAvailable: withWer.length > 0,
    fastest: fastest
      ? { engineId: fastest.engineId, engineShort: fastest.engineShort, processingMs: fastest.processingMs }
      : null,
    bestWer: bestWer
      ? { engineId: bestWer.engineId, engineShort: bestWer.engineShort, wer: bestWer.word.wer }
      : null,
    note: 'Que un motor termine sin error no significa que su transcripción sea correcta: compárala con el guion y revisa las diferencias.',
  };
}

