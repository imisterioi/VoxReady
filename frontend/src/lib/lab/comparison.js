// Comparación de motores sobre UNA misa grabación (laboratorio).
//
// Reglas:
//  - Todos los motores Whisper reciben EXACTAMENTE el mismo Blob y la misma duración.
//  - Se ejecutan en serie (nunca en paralelo) y un fallo no detiene a los siguientes.
//  - Speech API NO aparece aquí: usa el micrófono en vivo y no admite archivos.
//  - Cada ejecución se conserva: volver a ejecutar un motor añade una fila nueva.
//
// Módulo puro (sin React, sin red): recibe `transcribe` inyectado y se prueba con node.

import { getEngine } from './engines.js';

// Motores que SÍ pueden procesar audio grabado.
export const RECORDED_ENGINE_IDS = ['whisper-base', 'whisper-small', 'whisper-medium'];

// Estado de una fila recién creada, antes de ejecutar.
export function pendingRow(engine, { runId, audioMs } = {}) {
  return {
    runId: runId ?? null,
    engineId: engine.id,
    engine: engine.short || engine.label,
    modelKey: engine.modelKey,
    audioMs: audioMs ?? null,
    status: 'pendiente',
    text: '',
    error: null,
    startedAt: null,
    finishedAt: null,
    loadMs: null,
    processingMs: null,
    requestMs: null,
    totalMs: null,
    rtf: null,
    serverDurationMs: null,
  };
}

function rowFromResult(engine, result, { runId, audioMs, startedAt, finishedAt }) {
  const ok = result?.ok !== false && result?.status !== 'error';
  const processingMs = result?.processingMs ?? null;
  const serverDurationMs =
    result?.durationSeconds != null && Number.isFinite(result.durationSeconds)
      ? Math.round(result.durationSeconds * 1000)
      : null;
  const basis = serverDurationMs || audioMs || null;
  return {
    ...pendingRow(engine, { runId, audioMs }),
    status: ok ? 'ok' : 'error',
    text: ok ? String(result?.text || '') : String(result?.text || ''),
    error: ok ? null : result?.error || 'El motor no devolvió texto.',
    startedAt,
    finishedAt,
    loadMs: result?.loadMs ?? null,
    processingMs,
    requestMs: result?.clientMs ?? null,
    totalMs: result?.totalMs ?? result?.clientMs ?? null,
    // RTF = tiempo de PROCESAMIENTO / duración del audio (no la petición completa).
    rtf: processingMs != null && basis ? processingMs / basis : null,
    serverDurationMs,
  };
}

// Ejecuta los motores en serie sobre el mismo audio. Devuelve las filas en orden.
// `transcribe(blob, modelKey)` debe devolver { ok, text, processingMs, clientMs, ... }
// o lanzar; ambos casos quedan registrados.
export async function runEnginesOnRecording({
  engineIds = RECORDED_ENGINE_IDS,
  blob,
  audioMs = null,
  runId,
  transcribe,
  onUpdate,
  now = () => Date.now(),
} = {}) {
  if (!blob || !blob.size) throw new Error('No hay una grabación para procesar.');

  const rows = [];
  const emit = (extra = {}) => onUpdate?.({ runId, rows: [...rows], ...extra });

  for (const id of engineIds) {
    const engine = getEngine(id);
    if (!engine) continue;
    const startedAt = now();
    emit({ runningEngineId: id });

    let result;
    try {
      result = await transcribe(blob, engine.modelKey);
    } catch (error) {
      result = { ok: false, text: '', error: error?.message || 'Error al transcribir.' };
    }
    rows.push(rowFromResult(engine, result, { runId, audioMs, startedAt, finishedAt: now() }));
    emit({ runningEngineId: null });
  }

  return rows;
}

// Añade una ejecución al historial sin borrar las anteriores (misma grabación o nueva).
export function appendRun(history = [], runId, rows = []) {
  return [...(history || []), ...rows.map((row) => ({ ...row, runId }))];
}

// Filas listas para la tabla: la más reciente de cada motor primero, conservando todo.
export function latestByEngine(history = []) {
  const latest = new Map();
  for (const row of history) latest.set(row.engineId, row);
  return RECORDED_ENGINE_IDS.map((id) => latest.get(id)).filter(Boolean);
}

// CSV con comillas escapadas según RFC 4180 (texto puede contener ; " y saltos).
export function toComparisonCsv(rows = []) {
  const columns = [
    ['Motor', (r) => r.engine],
    ['Modelo', (r) => r.modelKey],
    ['Estado', (r) => r.status],
    ['Duración audio (s)', (r) => (r.audioMs == null ? '' : (r.audioMs / 1000).toFixed(2))],
    ['Carga modelo (ms)', (r) => (r.loadMs == null ? '' : Math.round(r.loadMs))],
    ['Procesamiento (ms)', (r) => (r.processingMs == null ? '' : Math.round(r.processingMs))],
    ['Petición (ms)', (r) => (r.requestMs == null ? '' : Math.round(r.requestMs))],
    ['Total (ms)', (r) => (r.totalMs == null ? '' : Math.round(r.totalMs))],
    ['RTF', (r) => (r.rtf == null ? '' : r.rtf.toFixed(3))],
    ['Fecha', (r) => (r.finishedAt ? new Date(r.finishedAt).toISOString() : '')],
    ['Texto', (r) => r.text || ''],
    ['Error', (r) => r.error || ''],
  ];
  // Los saltos de línea se convierten en espacio para que cada fila ocupe una sola línea
  // del CSV (Excel y las hojas de cálculo lo leen sin partir la fila).
  const escape = (value) => `"${String(value ?? '').replace(/\r?\n/g, ' ').replace(/"/g, '""')}"`;
  const header = columns.map(([label]) => escape(label)).join(';');
  const body = rows.map((row) => columns.map(([, get]) => escape(get(row))).join(';'));
  return [header, ...body].join('\r\n');
}
