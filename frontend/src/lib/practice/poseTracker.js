// Medición corporal con MediaPipe Pose (en el navegador, sin enviar video).
// Acumula durante la entrevista: presencia en cámara, mirada hacia la cámara,
// inclinación de hombros, movimiento de cabeza y manos, e iluminación.
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';

const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';
const FRAME_MS = 100; // ~10 análisis por segundo

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
    this.brightness = [];
    this.prev = null;
  }

  async load() {
    try {
      const vision = await FilesetResolver.forVisionTasks(WASM_URL);
      const create = (delegate) =>
        PoseLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: MODEL_URL, delegate },
          runningMode: 'VIDEO',
          numPoses: 1,
        });
      this.landmarker = await create('GPU').catch(() => create('CPU'));
      this.ready = true;
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

  analyze() {
    const video = this.video;
    if (!video || video.readyState < 2) return;

    const result = this.landmarker.detectForVideo(video, performance.now());
    const lm = result.landmarks?.[0];
    const s = this.stats;
    s.frames += 1;

    // Iluminación: una muestra por segundo
    if (s.frames % 10 === 0) this.sampleBrightness();

    this.personNow = Boolean(lm && visible(lm[L_SHOULDER]) && visible(lm[R_SHOULDER]));
    if (!this.personNow) {
      this.prev = null;
      return;
    }
    s.withPerson += 1;

    const shoulderWidth = dist(lm[L_SHOULDER], lm[R_SHOULDER]) || 1;

    // Mirada hacia la cámara: la nariz centrada entre las orejas (o los hombros)
    const leftRef = visible(lm[L_EAR]) ? lm[L_EAR] : lm[L_SHOULDER];
    const rightRef = visible(lm[R_EAR]) ? lm[R_EAR] : lm[R_SHOULDER];
    const span = Math.abs(leftRef.x - rightRef.x) || shoulderWidth;
    const yaw = Math.abs(lm[NOSE].x - (leftRef.x + rightRef.x) / 2) / span;
    if (yaw < 0.22) s.facing += 1;

    // Inclinación de hombros en grados
    const dy = Math.abs(lm[L_SHOULDER].y - lm[R_SHOULDER].y);
    const dx = Math.abs(lm[L_SHOULDER].x - lm[R_SHOULDER].x) || 1e-6;
    s.tiltSum += (Math.atan2(dy, dx) * 180) / Math.PI;
    s.tiltN += 1;

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
      },
      lighting,
    };
  }

  destroy() {
    this.stop();
    this.landmarker?.close?.();
  }
}
