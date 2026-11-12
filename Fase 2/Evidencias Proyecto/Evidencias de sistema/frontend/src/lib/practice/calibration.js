// Calibración del equipo del vocero (≈10 s): acumula muestras reales de micrófono y cámara y las
// clasifica en un resultado sencillo (micrófono / cámara / listo para comenzar).
//
// Lógica pura (sin React ni navegador) para poder probarla: la pantalla le pasa las muestras que
// recoge del analizador de audio (RMS 0-1, la misma escala que AudioMeter) y del vídeo/MediaPipe.
//
// Criterio tolerante: «volumen bajo» y «encuadre mejorable» avisan pero no bloquean; solo se bloquea
// lo que impediría practicar (sin señal de micrófono o cámara sin imagen).

export const CALIBRATION_MS = 10000; // duración objetivo
export const SAMPLE_MS = 100; // una muestra cada 100 ms (~100 muestras)

// Umbrales de micrófono (nivel RMS 0-1).
export const MIC_SILENT = 0.02; // por debajo: no hay señal
export const MIC_LOW = 0.08; // por debajo: volumen bajo
export const MIC_MIN_VOICED = 0.08; // proporción mínima de muestras con señal
export const NOISE_HIGH = 0.05; // piso de ruido alto (ruido de fondo evidente)
// Encuadre: proporción mínima de muestras con una persona detectada.
export const MIN_PERSON_RATIO = 0.5;

export function createCalibration({ durationMs = CALIBRATION_MS, now = () => Date.now() } = {}) {
  return {
    durationMs,
    startedAt: now(),
    samples: { total: 0, mic: 0, voiced: 0, peak: 0, floor: null, frames: 0, person: 0, personChecked: 0 },
  };
}

// Añade una muestra. `person` es true/false cuando el detector de presencia está disponible y null
// cuando no lo está (entonces el encuadre NO se juzga: no se puede saber).
export function addSample(state, { micLevel = null, hasImage = false, person = null } = {}) {
  const samples = { ...state.samples };
  samples.total += 1;
  if (typeof micLevel === 'number' && Number.isFinite(micLevel)) {
    samples.mic += 1;
    samples.peak = Math.max(samples.peak, micLevel);
    samples.floor = samples.floor == null ? micLevel : Math.min(samples.floor, micLevel);
    if (micLevel >= MIC_LOW) samples.voiced += 1;
  }
  if (hasImage) samples.frames += 1;
  if (person === true || person === false) {
    samples.personChecked += 1;
    if (person === true) samples.person += 1;
  }
  return { ...state, samples };
}

export function elapsedMs(state, now = () => Date.now()) {
  return Math.max(0, now() - state.startedAt);
}

export function progress(state, now = () => Date.now()) {
  return Math.min(1, elapsedMs(state, now) / state.durationMs);
}

export function isFinished(state, now = () => Date.now()) {
  return elapsedMs(state, now) >= state.durationMs;
}

// Resultado de la calibración:
//   mic.status    'ok' | 'low' | 'silent' | 'unavailable'
//   camera.status 'ok' | 'no-image' | 'framing'
//   ready         todo correcto (sin avisos)
//   canStart      no hay ningún problema que impida practicar
export function calibrationResult(state) {
  const s = state.samples;
  const voicedRatio = s.mic ? s.voiced / s.mic : 0;
  const personRatio = s.personChecked ? s.person / s.personChecked : null;

  let mic = 'ok';
  if (!s.mic) mic = 'unavailable';
  else if (s.peak < MIC_SILENT) mic = 'silent';
  else if (s.peak < MIC_LOW || voicedRatio < MIC_MIN_VOICED) mic = 'low';

  let camera = 'ok';
  if (!s.frames) camera = 'no-image';
  else if (personRatio != null && personRatio < MIN_PERSON_RATIO) camera = 'framing';

  // Ruido de fondo: solo se avisa cuando incluso el momento más silencioso es alto Y no hay una voz
  // clara por encima (con voz clara no se puede distinguir una sala ruidosa de una voz fuerte).
  const noise = s.floor != null && s.floor > NOISE_HIGH && s.peak < MIC_LOW * 2 ? 'high' : 'ok';

  return {
    durationMs: state.durationMs,
    samples: s,
    mic: { status: mic, peak: Number(s.peak.toFixed(4)), voicedRatio: Number(voicedRatio.toFixed(3)), noise },
    camera: {
      status: camera,
      personRatio: personRatio == null ? null : Number(personRatio.toFixed(3)),
      checked: s.personChecked > 0,
    },
    ready: mic === 'ok' && camera === 'ok',
    canStart: mic !== 'silent' && mic !== 'unavailable' && camera !== 'no-image',
  };
}
