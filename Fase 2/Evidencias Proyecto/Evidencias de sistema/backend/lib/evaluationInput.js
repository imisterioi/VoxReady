// Normalización y validación de la entrada de evaluación (transcripción + métricas).
//
// Objetivo: que el cliente NO pueda definir la puntuación con datos imposibles. Todo lo que
// llega en `POST /api/sessions/:id/evaluate` se valida aquí, se acota y se marca:
//
//  - Lo que se puede recalcular en el servidor (palabras, muletillas y, con una duración de
//    habla válida, palabras/minuto y muletillas/minuto) se RECALCULA.
//  - Lo que solo existe en el navegador (MediaPipe, AudioMeter: duración de habla, latencia,
//    pausas, variación de volumen, mirada/risa) se conserva como DECLARADO POR EL CLIENTE y
//    nunca se presenta como verificado.
//  - Los valores no numéricos, NaN, infinitos o fuera de rango se descartan (null) y quedan
//    registrados como advertencia; nunca se convierten en un valor que mejore el puntaje.
//
// No se inventan métricas para "poder guardar" el informe: si un área se queda sin datos,
// el evaluador la deja como no medida (comportamiento ya existente del proyecto).

const {
  MAX_ANSWER_CHARS,
  MAX_FILLERS_PER_MIN,
  MAX_WORDS,
  MAX_WPM,
  analyzeText,
} = require('./textMetrics');

const LIMITS = {
  turns: 60, // el escenario permite 30 turnos; 60 es un margen de seguridad
  questionChars: 2000,
  latencyMs: 600000, // 10 min para empezar a hablar ya es un dato inválido
  speakingMs: 3600000, // 1 h
  durationMs: 3600000,
  longPauses: 1000,
  volumeVariation: 10, // coef. de variación; 10 = 1000 %, no creíble
  presence: 1,
  facingCamera: 1,
  shoulderTilt: 90,
  headMovement: 1,
  handActivity: 1,
  seconds: 86400, // 24 h
  light: 255,
  warnings: 60, // tope para no inflar el JSON con un payload malicioso
};

const MAX_TOTAL_WORDS = MAX_WORDS * LIMITS.turns;

class EvaluationInputError extends Error {
  constructor(message, warnings = []) {
    super(message);
    this.name = 'EvaluationInputError';
    this.code = 'INVALID_INPUT';
    this.warnings = warnings;
  }
}

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

// Describe el valor SIN repetir su contenido (evita inyectar datos del cliente en el informe).
function typeOf(value) {
  if (typeof value === 'number') return Number.isNaN(value) ? 'NaN' : 'número no finito';
  if (Array.isArray(value)) return 'lista';
  return typeof value;
}

function pushWarning(warnings, code, path, message) {
  if (warnings.length >= LIMITS.warnings) return;
  warnings.push({ code, path, message });
}

// Número finito dentro de [min, max]. Cualquier otra cosa → null + advertencia.
function boundedNumber(value, { min = 0, max, integer = false, path, warnings }) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    pushWarning(warnings, 'INVALID_NUMBER', path, `Se descartó un valor no numérico (${typeOf(value)}).`);
    return null;
  }
  if (integer && !Number.isInteger(value)) {
    pushWarning(warnings, 'NOT_INTEGER', path, 'Se descartó un valor decimal donde se esperaba un entero.');
    return null;
  }
  if (value < min || value > max) {
    pushWarning(warnings, 'OUT_OF_RANGE', path, `Se descartó un valor fuera del rango permitido (${min}-${max}).`);
    return null;
  }
  return value;
}

function boundedText(value, maxChars, path, warnings) {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'string') {
    pushWarning(warnings, 'INVALID_TEXT', path, `Se ignoró un texto con tipo ${typeOf(value)}.`);
    return '';
  }
  const clean = value.trim();
  if (clean.length > maxChars) {
    pushWarning(warnings, 'TEXT_TOO_LONG', path, `Se recortó un texto de ${clean.length} caracteres.`);
    return clean.slice(0, maxChars);
  }
  return clean;
}

// Tramo de video de una respuesta (mirada/risa): segundos coherentes con lo analizado.
function normalizeVideo(raw, index, warnings) {
  if (!isObject(raw)) return null;
  const base = `transcript[${index}].metrics.video`;
  const analyzed = boundedNumber(raw.analyzedSeconds, { max: LIMITS.seconds, path: `${base}.analyzedSeconds`, warnings });
  const facing = boundedNumber(raw.facingSeconds, { max: LIMITS.seconds, path: `${base}.facingSeconds`, warnings });
  const away = boundedNumber(raw.awaySeconds, { max: LIMITS.seconds, path: `${base}.awaySeconds`, warnings });
  const smile = boundedNumber(raw.smileSeconds, { max: LIMITS.seconds, path: `${base}.smileSeconds`, warnings });
  if (analyzed == null) return null;

  // Las partes no pueden sumar mucho más que el total analizado (margen del 10 %).
  const limit = analyzed * 1.1 + 0.5;
  const coherent = [facing, away, smile].every((value) => value == null || value <= limit);
  if (!coherent) {
    pushWarning(warnings, 'VIDEO_INCONSISTENT', base, 'Los tiempos de mirada/risa superan el tiempo analizado.');
    return null;
  }
  return { analyzedSeconds: analyzed, facingSeconds: facing, awaySeconds: away, smileSeconds: smile };
}

// Métricas de un turno: solo se conservan las declaradas por el cliente que sean válidas.
// `declaredWpm/Words/Fillers` se guardan solo para contrastarlas con el recálculo del servidor.
function normalizeTurnMetrics(raw, index, warnings) {
  const empty = {
    declaredWpm: null,
    declaredWords: null,
    declaredFillers: null,
    latencyMs: null,
    durationMs: null,
    speakingMs: null,
    longPauses: null,
    volumeVariation: null,
    video: null,
  };
  if (!isObject(raw)) {
    if (raw !== undefined && raw !== null) {
      pushWarning(warnings, 'INVALID_TURN_METRICS', `transcript[${index}].metrics`, 'Las métricas del turno no son un objeto.');
    }
    return empty;
  }
  const base = `transcript[${index}].metrics`;
  return {
    declaredWpm: boundedNumber(raw.wpm, { max: MAX_WPM, path: `${base}.wpm`, warnings }),
    declaredWords: boundedNumber(raw.words, { max: MAX_WORDS, integer: true, path: `${base}.words`, warnings }),
    declaredFillers: boundedNumber(raw.fillers, { max: MAX_WORDS, integer: true, path: `${base}.fillers`, warnings }),
    latencyMs: boundedNumber(raw.latencyMs, { max: LIMITS.latencyMs, path: `${base}.latencyMs`, warnings }),
    durationMs: boundedNumber(raw.durationMs, { max: LIMITS.durationMs, path: `${base}.durationMs`, warnings }),
    speakingMs: boundedNumber(raw.speakingMs, { max: LIMITS.speakingMs, path: `${base}.speakingMs`, warnings }),
    longPauses: boundedNumber(raw.longPauses, { max: LIMITS.longPauses, integer: true, path: `${base}.longPauses`, warnings }),
    volumeVariation: boundedNumber(raw.volumeVariation, { max: LIMITS.volumeVariation, path: `${base}.volumeVariation`, warnings }),
    video: normalizeVideo(raw.video, index, warnings),
  };
}

// Transcripción: turnos con pregunta y respuesta. El texto se recorta y las palabras y
// muletillas se RECALCULAN en el servidor (el cliente no decide esos números).
function normalizeTranscript(rawTranscript, warnings) {
  if (!Array.isArray(rawTranscript) || rawTranscript.length === 0) {
    throw new EvaluationInputError('La entrevista no tiene preguntas registradas.', warnings);
  }
  if (rawTranscript.length > LIMITS.turns) {
    throw new EvaluationInputError(`La entrevista supera el máximo de ${LIMITS.turns} turnos.`, warnings);
  }

  const turns = [];
  rawTranscript.forEach((rawTurn, index) => {
    if (!isObject(rawTurn)) {
      pushWarning(warnings, 'INVALID_TURN', `transcript[${index}]`, 'Se descartó un turno que no es un objeto.');
      return;
    }
    const answer = boundedText(rawTurn.answer, MAX_ANSWER_CHARS, `transcript[${index}].answer`, warnings);
    const question = boundedText(rawTurn.question, LIMITS.questionChars, `transcript[${index}].question`, warnings);
    const declared = normalizeTurnMetrics(rawTurn.metrics, index, warnings);
    const text = analyzeText(answer);
    // El WPM del turno tampoco se deriva de la duración declarada: solo del audio.
    const wpm = null;

    if (declared.declaredWords != null && declared.declaredWords !== text.words) {
      pushWarning(
        warnings,
        'WORDS_MISMATCH',
        `transcript[${index}].metrics.words`,
        `El cliente declaró ${declared.declaredWords} palabra(s) y el servidor contó ${text.words}.`,
      );
    }
    if (declared.declaredFillers != null && declared.declaredFillers !== text.fillers) {
      pushWarning(
        warnings,
        'FILLERS_MISMATCH',
        `transcript[${index}].metrics.fillers`,
        `El cliente declaró ${declared.declaredFillers} muletilla(s) y el servidor contó ${text.fillers}.`,
      );
    }
    // El contraste con el WPM declarado se hace cuando hay audio (applySpeechEvidence):
    // antes no existe una fuente fiable con la que comparar.

    turns.push({
      question,
      answer,
      metrics: {
        words: text.words,
        fillers: text.fillers,
        fillerWords: text.fillerWords,
        // null hasta que el audio lo verifique (nunca desde speakingMs del navegador).
        wpm,
        speechSource: 'unverified',
        latencyMs: declared.latencyMs,
        durationMs: declared.durationMs,
        speakingMs: declared.speakingMs,
        longPauses: declared.longPauses,
        volumeVariation: declared.volumeVariation,
        video: declared.video,
      },
    });
  });

  if (!turns.length) throw new EvaluationInputError('La entrevista no tiene preguntas registradas.', warnings);
  if (!turns.some((turn) => turn.answer.length > 0)) {
    throw new EvaluationInputError('Ninguna respuesta tiene texto para evaluar.', warnings);
  }
  return { turns };
}

// Agregado de voz con la MISMA forma que consumía el evaluador.
function buildVoice(turns, rawVoice, warnings) {
  const valuesOf = (key) => turns.map((turn) => turn.metrics[key]).filter((value) => Number.isFinite(value));
  const sumOf = (key) => {
    const values = valuesOf(key);
    return values.length ? values.reduce((a, b) => a + b, 0) : null;
  };
  const meanOf = (key) => {
    const values = valuesOf(key);
    return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  };
  const base = 'metrics.voice';

  const fillers = turns.reduce((acc, turn) => acc + turn.metrics.fillers, 0);
  // Duración de HABLA declarada por el cliente (no la duración de la grabación).
  const speakingMs = sumOf('speakingMs');
  const longPauses =
    sumOf('longPauses') ??
    boundedNumber(rawVoice.longPauses, { max: LIMITS.longPauses, integer: true, path: `${base}.longPauses`, warnings });
  const volumeVariation =
    meanOf('volumeVariation') ??
    boundedNumber(rawVoice.volumeVariation, { max: LIMITS.volumeVariation, path: `${base}.volumeVariation`, warnings });
  const avgLatencyMs =
    meanOf('latencyMs') ??
    boundedNumber(rawVoice.avgLatencyMs, { max: LIMITS.latencyMs, path: `${base}.avgLatencyMs`, warnings });

  // La velocidad NO se calcula con la duración que declara el navegador: no es una fuente
  // verificada. Solo el audio de la sesión (Whisper) puede rellenar `wpm`; hasta entonces
  // queda en null y el criterio se excluye del cálculo (ver `applySpeechEvidence`).
  let fillersPerMin = null;
  if (speakingMs != null && speakingMs >= 3000) {
    const rate = fillers / (speakingMs / 60000);
    if (Number.isFinite(rate) && rate >= 0 && rate <= MAX_FILLERS_PER_MIN) fillersPerMin = rate;
    else pushWarning(warnings, 'IMPLAUSIBLE_RATE', `${base}.fillersPerMin`, 'La tasa de muletillas resultó implausible y se descartó.');
  }

  // Se conserva lo que declaró el cliente solo para contrastarlo con el audio (auditoría).
  const declaredWpm = boundedNumber(rawVoice.wpm, { max: MAX_WPM, path: `${base}.wpm`, warnings });

  const available = speakingMs != null && speakingMs >= 3000; // 0,05 min: mismo umbral que el frontend

  return {
    available,
    wpm: null,
    wpmSource: 'unverified',
    wpmReason: 'NO_AUDIO',
    declaredWpm,
    fillersPerMin,
    fillerWords: [...new Set(turns.flatMap((turn) => turn.metrics.fillerWords))].slice(0, 50),
    longPauses,
    longPausesPerAnswer: longPauses != null ? longPauses / turns.length : null,
    volumeVariation,
    avgLatencyMs,
    speakingSeconds: speakingMs != null ? Math.round(speakingMs / 1000) : 0,
    transcription: rawVoice.transcription === 'texto' ? 'texto' : 'voz',
  };
}

// Cuerpo (MediaPipe): el servidor NO puede recalcularlo; solo valida y deja constancia.
function normalizeBody(raw, warnings) {
  if (!isObject(raw)) return { available: false };
  const base = 'metrics.body';
  const presence = boundedNumber(raw.presence, { max: LIMITS.presence, path: `${base}.presence`, warnings });
  const facingCamera = boundedNumber(raw.facingCamera, { max: LIMITS.facingCamera, path: `${base}.facingCamera`, warnings });
  const shoulderTilt = boundedNumber(raw.shoulderTilt, { max: LIMITS.shoulderTilt, path: `${base}.shoulderTilt`, warnings });
  const headMovement = boundedNumber(raw.headMovement, { max: LIMITS.headMovement, path: `${base}.headMovement`, warnings });
  const handActivity = boundedNumber(raw.handActivity, { max: LIMITS.handActivity, path: `${base}.handActivity`, warnings });
  const analyzedSeconds = boundedNumber(raw.analyzedSeconds, { max: LIMITS.seconds, path: `${base}.analyzedSeconds`, warnings });
  const facingSeconds = boundedNumber(raw.facingSeconds, { max: LIMITS.seconds, path: `${base}.facingSeconds`, warnings });
  const awaySeconds = boundedNumber(raw.awaySeconds, { max: LIMITS.seconds, path: `${base}.awaySeconds`, warnings });
  const faceAvailable = raw.faceAvailable === true;
  const smileSeconds = faceAvailable
    ? boundedNumber(raw.smileSeconds, { max: LIMITS.seconds, path: `${base}.smileSeconds`, warnings })
    : null;

  const declaredAvailable = raw.available === true;
  // Sin presencia ni mirada válidas no se puede puntuar el área: se deja sin medir.
  const available = declaredAvailable && presence != null && facingCamera != null;
  if (declaredAvailable && !available) {
    pushWarning(warnings, 'BODY_INCOMPLETE', base, 'El navegador declaró el cuerpo medido pero faltan presencia o mirada; el área queda sin medir.');
  }
  if (!available) return { available: false };

  return {
    available: true,
    presence,
    facingCamera,
    shoulderTilt,
    headMovement,
    handActivity,
    analyzedSeconds,
    facingSeconds,
    awaySeconds,
    smileSeconds,
    faceAvailable,
  };
}

function normalizeLighting(raw, warnings) {
  if (!isObject(raw)) return null;
  const average = boundedNumber(raw.average, { max: LIMITS.light, path: 'metrics.lighting.average', warnings });
  return average == null ? null : { average };
}

// Procedencia de cada métrica: se guarda en el informe para no presentar como verificado
// lo que sigue dependiendo del navegador.
const SOURCES = {
  words: 'server',
  fillers: 'server',
  fillerWords: 'server',
  // `wpm` solo pasa a 'server-audio' cuando el audio lo verifica; si no, queda excluido.
  wpm: 'unverified',
  fillersPerMin: 'mixed',
  speakingMs: 'client',
  latencyMs: 'client',
  longPauses: 'client',
  volumeVariation: 'client',
  body: 'client',
  lighting: 'client',
  durationSeconds: 'client',
};

const SOURCE_NOTES = {
  server: 'Calculado en el servidor a partir del texto de las respuestas.',
  'server-audio': 'Calculado en el servidor sobre el audio de la sesión (Whisper) y sus marcas temporales por palabra.',
  mixed: 'Calculado en el servidor sobre una duración de habla declarada por el cliente.',
  client: 'Capturado en el navegador (AudioMeter/MediaPipe); el servidor no puede recalcularlo.',
  unverified: 'No se pudo verificar en el servidor: el criterio queda fuera del cálculo (ni 0 ni 100).',
};

// ------------------------------------------------- evidencia del audio (Whisper)

// Aplica el veredicto del audio. Si está verificado, el WPM y el tiempo de habla pasan a
// ser del SERVIDOR; si no, el criterio queda excluido (null) con su motivo explícito.
// No toca los pesos de la rúbrica: `average()` reparte el peso entre los criterios medidos.
function applySpeechEvidence(input, evidence) {
  const voice = input.metrics.voice;
  const warnings = input.warnings;
  const byTurn = new Map((evidence?.turns || []).map((turn) => [turn.index, turn]));
  const verified = evidence?.status === 'verified';

  input.transcript.forEach((turn, index) => {
    const item = byTurn.get(index);
    if (verified && item?.verified) {
      turn.metrics.wpm = item.wpm;
      turn.metrics.speakingMs = item.speechMs; // tiempo de habla del audio
      turn.metrics.speechSource = 'audio';
    } else {
      turn.metrics.wpm = null;
      turn.metrics.speechSource = 'unverified';
    }
  });

  if (verified) {
    voice.wpm = evidence.wpm;
    voice.wpmSource = 'audio';
    voice.wpmReason = null;
    voice.verifiedSpeechMs = evidence.speechMs;
    voice.verifiedWords = evidence.words;
    // Hay audio medido aunque el navegador no hubiera declarado duración de habla.
    voice.available = true;
    input.sources.wpm = 'server-audio';
    // Contraste con lo declarado por el navegador: manipulación o desfase real de la captura.
    if (voice.declaredWpm != null && Math.abs(voice.declaredWpm - evidence.wpm) > Math.max(10, evidence.wpm * 0.15)) {
      pushWarning(
        warnings,
        'WPM_MISMATCH',
        'metrics.voice.wpm',
        `El cliente declaró ${Math.round(voice.declaredWpm)} pal/min y el audio muestra ${Math.round(evidence.wpm)}.`,
      );
    }
  } else {
    const reason = evidence?.reason || 'NO_AUDIO';
    voice.wpm = null;
    voice.wpmSource = 'unverified';
    voice.wpmReason = reason;
    input.sources.wpm = 'unverified';
    pushWarning(
      warnings,
      'WPM_UNVERIFIED',
      'metrics.voice.wpm',
      `No se pudo verificar la velocidad con el audio (${reason}); el criterio se excluye del cálculo.`,
    );
  }

  // Solo números y veredictos: el texto transcrito no se guarda en la auditoría.
  input.speech = evidence ?? null;
  input.coverage.wpmVerified = verified;
  return input;
}

// Punto de entrada: valida y normaliza todo lo que llega del cliente.
// Lanza EvaluationInputError solo cuando NO hay nada evaluable.
function normalizeEvaluateInput({ transcript: rawTranscript, metrics: rawMetrics } = {}) {
  const warnings = [];
  const { turns } = normalizeTranscript(rawTranscript, warnings);

  if (rawMetrics !== undefined && rawMetrics !== null && !isObject(rawMetrics)) {
    pushWarning(warnings, 'INVALID_METRICS', 'metrics', 'Las métricas no son un objeto y se ignoraron.');
  }
  const raw = isObject(rawMetrics) ? rawMetrics : {};

  const voice = buildVoice(turns, isObject(raw.voice) ? raw.voice : {}, warnings);
  const body = normalizeBody(isObject(raw.body) ? raw.body : null, warnings);
  const lighting = normalizeLighting(isObject(raw.lighting) ? raw.lighting : null, warnings);
  const durationSeconds = boundedNumber(raw.durationSeconds, {
    max: LIMITS.seconds,
    path: 'metrics.durationSeconds',
    warnings,
  });

  return {
    transcript: turns,
    metrics: { voice, body, lighting, durationSeconds },
    warnings,
    sources: { ...SOURCES },
    sourceNotes: { ...SOURCE_NOTES },
    coverage: {
      turns: turns.length,
      answered: turns.filter((turn) => turn.answer.length > 0).length,
      voice: voice.available,
      body: body.available,
      lighting: lighting != null,
      speakingSeconds: voice.speakingSeconds,
      wpmVerified: false, // solo cambia si el audio lo verifica (applySpeechEvidence)
    },
  };
}

module.exports = {
  EvaluationInputError,
  LIMITS,
  SOURCES,
  SOURCE_NOTES,
  applySpeechEvidence,
  buildVoice,
  normalizeBody,
  normalizeEvaluateInput,
  normalizeTranscript,
  normalizeTurnMetrics,
};




