// Auditoria tecnica de la entrevista (OPCIONAL: APAGADA por defecto).
//
// Objetivo: poder RECONSTRUIR una entrevista real turno a turno (que pregunto el entrevistador, que
// respondio el vocero, que modelo genero cada pregunta, que modelos clasificaron, que prompt recibio
// el clasificador, que respondio el proveedor, como se proceso y que decidio el sistema) sin tocar
// la base de datos ni cambiar el comportamiento.
//
// Se activa con variables de entorno (temporales, en el proceso):
//   INTERVIEW_AUDIT=1                activa el registro
//   INTERVIEW_AUDIT_FILE=<ruta>      archivo destino (por defecto `uploads/interview-audit.jsonl`)
//
// Reglas del modulo:
//  - Un objeto JSON por linea (JSONL). Cada linea lleva `type`, `at`, `sessionId` y `turn`.
//  - El registro es un OBSERVADOR: nunca lanza y nunca altera lo que devuelve el sistema.
//  - NUNCA se registran credenciales: no se escriben encabezados ni claves, y cualquier campo con
//    nombre sensible se descarta (defensa en profundidad).
//  - `fetchRecorder` envuelve al `fetch` real y anota una COPIA de la respuesta (`clone()`) para no
//    consumir el cuerpo que el sistema todavia necesita.
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_FILE = path.join(__dirname, '..', 'uploads', 'interview-audit.jsonl');
const ENABLED_VALUES = ['1', 'true', 'on', 'yes'];
// Claves que NUNCA se escriben. El patron va anclado para no confundir campos legitimos que
// contienen la palabra «token» (por ejemplo `maxTokens`).
const SENSITIVE_KEY = /^(authorization|proxy-authorization|api[-_]?key|apikey|access[-_]?token|refresh[-_]?token|token|secret|client[-_]?secret|password|cookie|set-cookie|credentials?)$/i;
const MAX_TEXT = 8000;
const MAX_ITEMS = 40;

function settings(env = process.env) {
  const flag = String(env.INTERVIEW_AUDIT ?? '').trim().toLowerCase();
  const file = String(env.INTERVIEW_AUDIT_FILE ?? '').trim();
  return { enabled: ENABLED_VALUES.includes(flag), file: file || DEFAULT_FILE };
}

const isEnabled = (env = process.env) => settings(env).enabled;

// Copia saneada: descarta claves sensibles, recorta textos largos y limita profundidad y tamano.
function redact(value, depth = 0) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value.length > MAX_TEXT ? `${value.slice(0, MAX_TEXT)}…[recortado]` : value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (depth >= 6) return '[profundidad maxima]';
  if (Array.isArray(value)) return value.slice(0, MAX_ITEMS).map((item) => redact(item, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      if (SENSITIVE_KEY.test(key)) continue;
      out[key] = redact(item, depth + 1);
    }
    return out;
  }
  return `[${typeof value}]`;
}

// Escritura (nunca lanza). Devuelve true si se escribio.
function append(record, env = process.env) {
  const { enabled, file } = settings(env);
  if (!enabled) return false;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${JSON.stringify({ at: new Date().toISOString(), ...redact(record) })}\n`, 'utf8');
    return true;
  } catch (error) {
    console.warn('[Auditoria] no se pudo escribir el registro:', error?.message);
    return false;
  }
}

const hostOf = (url) => {
  try {
    return new URL(String(url)).host;
  } catch {
    return String(url).slice(0, 80);
  }
};

// Fotografia de la peticion: lo que el sistema envia al proveedor (sin encabezados ni credenciales).
function requestSnapshot(url, init = {}) {
  let body = null;
  try {
    body = JSON.parse(init?.body ?? 'null');
  } catch {
    body = null;
  }
  return {
    host: hostOf(url),
    model: body?.model ?? null,
    maxTokens: body?.max_tokens ?? null,
    temperature: body?.temperature ?? null,
    messages: body?.messages ?? null,
  };
}

// `fetch` observador: registra peticion + copia de la respuesta y devuelve la respuesta ORIGINAL.
// `kind`: 'generation' (preguntas) | 'classification' (suficiencia).
function fetchRecorder({
  kind,
  sessionId = null,
  turn = null,
  level = null,
  model = null,
  dispatchKind = null,
  phase = null,
  fetchImpl = globalThis.fetch,
  env = process.env,
} = {}) {
  return async function auditedFetch(url, init = {}) {
    const startedAt = Date.now();
    let response;
    try {
      response = await fetchImpl(url, init);
    } catch (error) {
      append(
        {
          type: 'provider-request',
          kind,
          sessionId,
          turn,
          level,
          model,
          dispatchKind,
          phase,
          ok: false,
          ms: Date.now() - startedAt,
          request: requestSnapshot(url, init),
          error: { name: error?.name || 'Error', message: String(error?.message || '').slice(0, 300) },
        },
        env,
      );
      throw error;
    }
    const ms = Date.now() - startedAt;
    let payload = null;
    try {
      const clone = typeof response?.clone === 'function' ? response.clone() : null;
      payload = clone ? await clone.json() : null;
    } catch {
      payload = null;
    }
    append(
      {
        type: 'provider-request',
        kind,
        sessionId,
        turn,
        level,
        model,
        dispatchKind,
        phase,
        ok: Boolean(response?.ok),
        status: response?.status ?? null,
        ms,
        request: requestSnapshot(url, init),
        response: payload,
      },
      env,
    );
    return response;
  };
}

// Resumen del turno: resultado del clasificador, decision, presupuestos y pregunta entregada.
function writeTurn(record, env = process.env) {
  return append({ type: 'turn', ...record }, env);
}

module.exports = { DEFAULT_FILE, isEnabled, settings, redact, append, fetchRecorder, writeTurn, requestSnapshot };
