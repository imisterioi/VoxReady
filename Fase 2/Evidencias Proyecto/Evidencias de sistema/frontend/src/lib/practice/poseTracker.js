// Medición corporal con MediaPipe (en el navegador, sin enviar video).
// Acumula durante la entrevista: presencia en cámara, mirada hacia la cámara,
// inclinación de hombros, movimiento de cabeza y manos, e iluminación (Pose),
// y además dirección de los ojos y sonrisa/risa (Face, para el análisis de sensibilidad).
import { FaceLandmarker, FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';

// Dependencias reales de MediaPipe, agrupadas para que `load()` pueda recibir un sustituto en las
// pruebas (contrato verificable sin red ni navegador). En producción siempre se usan estas.
const MEDIAPIPE = { FaceLandmarker, FilesetResolver, PoseLandmarker };

const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';
const FACE_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const FRAME_MS = 100; // ~10 análisis por segundo
const MAX_FRAME_GAP_MS = 500; // si el análisis se atrasa, no se le atribuye más tiempo que esto a un cuadro

// Umbrales de los gestos del rostro (blendshapes de MediaPipe, de 0 a 1)
const SMILE_MIN = 0.45; // sonrisa o risa
const EYES_SIDE_MAX = 0.55; // ojos hacia un costado
const EYES_UP_MAX = 0.5; // ojos hacia arriba
const EYES_DOWN_MAX = 0.75; // ojos hacia abajo (tolerante: la pantalla suele estar bajo la cámara)

// Pose inicial: se toma con los primeros cuadros con persona después de marcarla
const BASELINE_FRAMES = 15;
const OFF_POSE_TILT_DEG = 6; // hombros más inclinados que la pose inicial
const OFF_POSE_SHIFT = 0.35; // cabeza desplazada (en anchos de hombro)
const SHRINK_MIN = 0.15; // encogimiento: el cuello "se acorta" un 15 % respecto de la pose inicial

export const EMOTIONS = ['neutral', 'happiness', 'anger', 'surprise', 'sadness'];

// Emoción dominante del rostro a partir de los blendshapes de MediaPipe (0-1)
export function classifyEmotion(v) {
  const avg = (a, b) => ((v[a] || 0) + (v[b] || 0)) / 2;
  if (avg('mouthSmileLeft', 'mouthSmileRight') > SMILE_MIN) return 'happiness';
  const browDown = avg('browDownLeft', 'browDownRight');
  const sneer = avg('noseSneerLeft', 'noseSneerRight');
  const press = avg('mouthPressLeft', 'mouthPressRight');
  if (browDown > 0.4 && (sneer > 0.25 || press > 0.3)) return 'anger';
  const eyeWide = avg('eyeWideLeft', 'eyeWideRight');
  if ((v.browInnerUp || 0) > 0.5 && (eyeWide > 0.35 || (v.jawOpen || 0) > 0.4)) return 'surprise';
  if (avg('mouthFrownLeft', 'mouthFrownRight') > 0.3 && (v.browInnerUp || 0) > 0.25) return 'sadness';
  return 'neutral';
}

const emptyEmotions = () => Object.fromEntries(EMOTIONS.map((e) => [e, 0]));

// Índices de MediaPipe Pose
const NOSE = 0;
const L_EAR = 7;
const R_EAR = 8;
const L_SHOULDER = 11;
const R_SHOULDER = 12;
const L_WRIST = 15;
const R_WRIST = 16;

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const visible = (p) => p && (p.visibility ?? 1) > 0.5;
const toSeconds = (ms) => Math.round(ms / 100) / 10;

export default class PoseTracker {
  constructor(video) {
    this.video = video;
    this.ready = false;
    this.running = false;
    this.personNow = false;
    this.reset();
  }

  reset() {
    this.stats = { frames: 0, withPerson: 0, facing: 0, tiltSum: 0, tiltN: 0, headSum: 0, headN: 0, handSum: 0, handN: 0 };
    // Tiempos acumulados (ms): analizado, mirando a la cámara, mirando a otro lado y sonriendo
    this.time = { analyzed: 0, facing: 0, away: 0, smile: 0, offPose: 0, shrink: 0 };
    this.emotions = emptyEmotions();
    this.offPoseRun = 0;
    this.offPoseMax = 0;
    this.baseline = null;
    this.baselineSamples = [];
    this.faceFrames = 0;
    this.segmentStart = null;
    this.lastFrameAt = null;
    this.brightness = [];
    this.prev = null;
  }

  // Carga los modelos. `face: false` carga SOLO el corporal (lo usa la calibración, que únicamente
  // necesita `personNow`): evita descargar/compilar el modelo facial y ejecutar su inferencia.
  // La entrevista sigue llamando `load()` sin argumentos ⇒ mismo comportamiento que siempre.
  // `deps` es un punto de inyección EXCLUSIVO para las pruebas (nunca se usa desde la interfaz).
  async load({ face = true, deps = null } = {}) {
    const { FilesetResolver: resolveFileset, PoseLandmarker: Pose, FaceLandmarker: Face } = deps || MEDIAPIPE;
    try {
      const vision = await resolveFileset.forVisionTasks(WASM_URL);
      const create = (delegate) =>
        Pose.createFromOptions(vision, {
          baseOptions: { modelAssetPath: MODEL_URL, delegate },
          runningMode: 'VIDEO',
          numPoses: 1,
        });
      this.landmarker = await create('GPU').catch(() => create('CPU'));
      this.ready = true;

      // Sin rostro pedido no se crea FaceLandmarker: `readFace()` ya devuelve null en ese caso y el
      // resto de la medición (presencia, mirada por pose, hombros, manos, iluminación) no lo usa.
      if (!face) {
        this.faceLandmarker = null;
        return this.ready;
      }

      // Rostro: opcional. Si no carga, se sigue midiendo el cuerpo (sin risa ni dirección de los ojos)
      const createFace = (delegate) =>
        Face.createFromOptions(vision, {
          baseOptions: { modelAssetPath: FACE_MODEL_URL, delegate },
          runningMode: 'VIDEO',
          numFaces: 1,
          outputFaceBlendshapes: true,
        });
      this.faceLandmarker = await createFace('GPU')
        .catch(() => createFace('CPU'))
        .catch((error) => {
          console.warn('No se pudo cargar el análisis de rostro:', error);
          return null;
        });
    } catch (error) {
      console.warn('No se pudo cargar MediaPipe:', error);
      this.ready = false;
    }
    return this.ready;
  }

  start() {
    if (!this.ready || this.running) return;
    this.running = true;
    this.canvas = document.createElement('canvas');
    this.canvas.width = 32;
    this.canvas.height = 18;
    this.loop();
  }

  stop() {
    this.running = false;
    clearTimeout(this.timer);
  }

  loop = () => {
    if (!this.running) return;
    try {
      this.analyze();
    } catch (error) {
      console.warn('Error analizando pose:', error);
    }
    this.timer = setTimeout(this.loop, FRAME_MS);
  };

  // Marca la pose inicial: los próximos cuadros con persona definen la postura de referencia
  markBaseline() {
    this.baseline = null;
    this.baselineSamples = [];
    this.offPoseRun = 0;
  }

  // Gestos del rostro en este cuadro: { smiling, eyesAway, emotion } o null si no se ve la cara
  readFace(now) {
    if (!this.faceLandmarker) return null;
    const shapes = this.faceLandmarker.detectForVideo(this.video, now).faceBlendshapes?.[0]?.categories;
    if (!shapes) return null;
    const v = Object.fromEntries(shapes.map((c) => [c.categoryName, c.score]));
    const side = Math.max((v.eyeLookOutLeft + v.eyeLookInRight) / 2, (v.eyeLookInLeft + v.eyeLookOutRight) / 2);
    const up = (v.eyeLookUpLeft + v.eyeLookUpRight) / 2;
    const down = (v.eyeLookDownLeft + v.eyeLookDownRight) / 2;
    return {
      smiling: (v.mouthSmileLeft + v.mouthSmileRight) / 2 > SMILE_MIN,
      eyesAway: side > EYES_SIDE_MAX || up > EYES_UP_MAX || down > EYES_DOWN_MAX,
      emotion: classifyEmotion(v),
    };
  }

  analyze() {
    const video = this.video;
    if (!video || video.readyState < 2) return;

    const now = performance.now();
    const elapsed = this.lastFrameAt == null ? FRAME_MS : Math.min(now - this.lastFrameAt, MAX_FRAME_GAP_MS);
    this.lastFrameAt = now;

    const result = this.landmarker.detectForVideo(video, now);
    const lm = result.landmarks?.[0];
    const face = this.readFace(now);
    const s = this.stats;
    const t = this.time;
    s.frames += 1;
    t.analyzed += elapsed;
    if (face) {
      this.faceFrames += 1;
      if (face.smiling) t.smile += elapsed;
      this.emotions[face.emotion] = (this.emotions[face.emotion] || 0) + elapsed;
    }

    // Iluminación: una muestra por segundo
    if (s.frames % 10 === 0) this.sampleBrightness();

    this.personNow = Boolean(lm && visible(lm[L_SHOULDER]) && visible(lm[R_SHOULDER]));
    if (!this.personNow) {
      this.prev = null;
      t.away += elapsed; // fuera de cuadro: no está mirando a la cámara
      return;
    }
    s.withPerson += 1;

    const shoulderWidth = dist(lm[L_SHOULDER], lm[R_SHOULDER]) || 1;

    // Mirada hacia la cámara: la nariz centrada entre las orejas (o los hombros)
    // y, si se ve el rostro, los ojos sin desviarse hacia un costado, arriba o abajo
    const leftRef = visible(lm[L_EAR]) ? lm[L_EAR] : lm[L_SHOULDER];
    const rightRef = visible(lm[R_EAR]) ? lm[R_EAR] : lm[R_SHOULDER];
    const span = Math.abs(leftRef.x - rightRef.x) || shoulderWidth;
    const yaw = Math.abs(lm[NOSE].x - (leftRef.x + rightRef.x) / 2) / span;
    const facing = yaw < 0.22 && !face?.eyesAway;
    if (facing) {
      s.facing += 1;
      t.facing += elapsed;
    } else {
      t.away += elapsed;
    }

    // Inclinación de hombros en grados
    const dy = Math.abs(lm[L_SHOULDER].y - lm[R_SHOULDER].y);
    const dx = Math.abs(lm[L_SHOULDER].x - lm[R_SHOULDER].x) || 1e-6;
    const tilt = (Math.atan2(dy, dx) * 180) / Math.PI;
    s.tiltSum += tilt;
    s.tiltN += 1;
    this.trackPose(lm, tilt, shoulderWidth, elapsed);

    // Movimiento de cabeza y manos entre análisis (normalizado)
    if (this.prev) {
      s.headSum += dist(lm[NOSE], this.prev[NOSE]);
      s.headN += 1;
      for (const w of [L_WRIST, R_WRIST]) {
        if (visible(lm[w]) && visible(this.prev[w])) {
          s.handSum += dist(lm[w], this.prev[w]);
          s.handN += 1;
        }
      }
    }
    this.prev = lm;
  }

  // Compara el cuadro con la pose inicial: tiempo fuera de ella (y su racha más larga) y encogimiento
  trackPose(lm, tilt, width, elapsed) {
    const midX = (lm[L_SHOULDER].x + lm[R_SHOULDER].x) / 2;
    const midY = (lm[L_SHOULDER].y + lm[R_SHOULDER].y) / 2;
    // Altura del cuello: nariz sobre la línea de hombros, en anchos de hombro
    const neck = (midY - lm[NOSE].y) / width;
    const sample = { tilt, neck, noseX: (lm[NOSE].x - midX) / width, width };
    if (!this.baseline) {
      this.baselineSamples.push(sample);
      if (this.baselineSamples.length >= BASELINE_FRAMES) {
        const n = this.baselineSamples.length;
        const mean = (k) => this.baselineSamples.reduce((a, x) => a + x[k], 0) / n;
        this.baseline = { tilt: mean('tilt'), neck: mean('neck'), noseX: mean('noseX'), width: mean('width') };
      }
      return;
    }
    const b = this.baseline;
    const shrunk = b.neck > 0 && neck < b.neck * (1 - SHRINK_MIN);
    const off =
      shrunk || Math.abs(tilt - b.tilt) > OFF_POSE_TILT_DEG || Math.abs(sample.noseX - b.noseX) > OFF_POSE_SHIFT;
    if (shrunk) this.time.shrink += elapsed;
    if (off) {
      this.time.offPose += elapsed;
      this.offPoseRun += elapsed;
      this.offPoseMax = Math.max(this.offPoseMax, this.offPoseRun);
    } else {
      this.offPoseRun = 0;
    }
  }

  // Tramo de la entrevista (una pregunta y su respuesta): permite saber en qué
  // momento el vocero miró a otro lado o se rió, para cruzarlo con lo que decía.
  beginSegment() {
    this.segmentStart = { ...this.time };
  }

  endSegment() {
    const from = this.segmentStart;
    this.segmentStart = null;
    if (!this.ready || !from) return null;
    const t = this.time;
    return {
      seconds: toSeconds(t.analyzed - from.analyzed),
      facingSeconds: toSeconds(t.facing - from.facing),
      awaySeconds: toSeconds(t.away - from.away),
      smileSeconds: toSeconds(t.smile - from.smile),
    };
  }

  sampleBrightness() {
    const ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);
    const px = ctx.getImageData(0, 0, this.canvas.width, this.canvas.height).data;
    let total = 0;
    for (let i = 0; i < px.length; i += 4) total += 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    this.brightness.push(total / (px.length / 4));
  }

  summary() {
    const s = this.stats;
    const t = this.time;
    const lighting = this.brightness.length
      ? { average: this.brightness.reduce((a, b) => a + b, 0) / this.brightness.length }
      : { average: null };

    if (!this.ready || s.frames < 10) return { body: { available: false }, lighting };

    return {
      body: {
        available: true,
        frames: s.frames,
        presence: s.withPerson / s.frames,
        facingCamera: s.withPerson ? s.facing / s.withPerson : 0,
        shoulderTilt: s.tiltN ? s.tiltSum / s.tiltN : null,
        headMovement: s.headN ? s.headSum / s.headN : null,
        handActivity: s.handN ? s.handSum / s.handN : null,
        // Análisis de sensibilidad: tiempos en segundos
        analyzedSeconds: toSeconds(t.analyzed),
        facingSeconds: toSeconds(t.facing),
        awaySeconds: toSeconds(t.away),
        smileSeconds: toSeconds(t.smile),
        faceAvailable: this.faceFrames > 0, // sin rostro detectado no se puede medir la risa
        // Postura respecto de la pose inicial (null si no se alcanzó a marcarla)
        baselineCaptured: Boolean(this.baseline),
        offPoseSeconds: this.baseline ? toSeconds(t.offPose) : null,
        offPoseMaxSeconds: this.baseline ? toSeconds(this.offPoseMax) : null,
        shrinkSeconds: this.baseline ? toSeconds(t.shrink) : null,
        // Expresiones faciales: segundos con cada emoción dominante
        emotions: this.faceFrames > 0 ? Object.fromEntries(EMOTIONS.map((e) => [e, toSeconds(this.emotions[e] || 0)])) : null,
      },
      lighting,
    };
  }

  destroy() {
    this.stop();
    this.landmarker?.close?.();
    this.faceLandmarker?.close?.();
  }
}
