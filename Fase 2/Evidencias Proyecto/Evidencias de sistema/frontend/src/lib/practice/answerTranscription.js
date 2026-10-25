// Transcripción por respuesta: decide CUÁNDO pedirla y cómo interpretar la respuesta del backend.
// Módulo puro (sin DOM ni red) para poder probarlo sin navegador.
//
// Reglas:
//  - modo texto: la respuesta ya es texto, no se transcribe nada;
//  - sin ventana de audio utilizable: no se puede recortar la respuesta;
//  - sin voz detectada: es un SILENCIO real (la evaluación final transcribe el audio igualmente);
//  - con voz detectada: se pide la transcripción aunque el ASR falle, para poder distinguir
//    "habló pero no se pudo transcribir" de "no dijo nada".

export const TRANSCRIPT_SOURCE = { live: 'live', unavailable: 'unavailable', typed: 'typed' };

// Presupuesto del cliente algo mayor que el del backend (12 s): así el servidor decide primero y
// una respuesta lenta no se corta por red.
export const TRANSCRIPT_TIMEOUT_MS = 15000;

// ¿Corresponde pedir la transcripción de este turno? Devuelve siempre un motivo para el registro.
export function transcriptionRequest({ textMode = false, spoke = false, startMs = null, endMs = null } = {}) {
  if (textMode) return { needed: false, reason: 'texto' };
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return { needed: false, reason: 'sin_ventana' };
  }
  if (spoke !== true) return { needed: false, reason: 'silencio' };
  return { needed: true, reason: 'voz' };
}

// Interpreta el resultado de `POST /api/sessions/:id/answer-transcript`. Nunca lanza.
// `source: 'unavailable'` significa "se detectó voz, pero no hay transcripción utilizable": el
// turno NO debe clasificarse como silencio.
export function normalizeTranscription({ ok = false, status = null, body = null } = {}) {
  if (!ok) {
    return { text: '', source: TRANSCRIPT_SOURCE.unavailable, code: 'UPLOAD_FAILED', status };
  }
  const text = String(body?.text ?? '').trim();
  if (!text) {
    return { text: '', source: TRANSCRIPT_SOURCE.unavailable, code: String(body?.code || 'NO_TRANSCRIPT'), status };
  }
  return { text, source: TRANSCRIPT_SOURCE.live, code: null, status };
}
