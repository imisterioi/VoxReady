// Pruebas de PoseTracker: contrato de `load({ face })` y comportamiento de la medición con y sin
// FaceLandmarker. Sin navegador y sin red: las dependencias de MediaPipe se inyectan con `deps`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import PoseTracker from './poseTracker.js';

// --- dobles de MediaPipe -----------------------------------------------------------------------
const makeLandmarker = (kind, calls) => ({
  kind,
  detectForVideo: () => ({ landmarks: [] }),
  close: () => calls.push(`close:${kind}`),
});

const mediapipeDeps = ({ failGpu = false, failAll = false, failFace = false } = {}) => {
  const calls = [];
  const attempts = [];
  const createPose = async (vision, options) => {
    const delegate = options.baseOptions.delegate;
    attempts.push(`pose:${delegate}`);
    if (failAll) throw new Error('sin pose');
    if (failGpu && delegate === 'GPU') throw new Error('sin GPU');
    return makeLandmarker('pose', calls);
  };
  const createFace = async (vision, options) => {
    const delegate = options.baseOptions.delegate;
    attempts.push(`face:${delegate}`);
    if (failFace) throw new Error('sin face');
    return makeLandmarker('face', calls);
  };
  return {
    calls,
    attempts,
    deps: {
      FilesetResolver: { forVisionTasks: async () => ({ vision: true }) },
      PoseLandmarker: { createFromOptions: createPose },
      FaceLandmarker: { createFromOptions: createFace },
    },
  };
};

// --- dobles de DOM mínimos para analizar cuadros -----------------------------------------------
const fakeVideo = { readyState: 2, videoWidth: 640 };
const fakeCanvas = () => ({
  width: 32,
  height: 18,
  getContext: () => ({
    drawImage: () => {},
    getImageData: () => ({ data: new Uint8ClampedArray(32 * 18 * 4).fill(120) }),
  }),
});

// Cuerpo simétrico y visible: nariz centrada entre orejas/hombros ⇒ presencia y mirada al frente.
const bodyLandmarks = () => {
  const points = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 1 }));
  points[0] = { x: 0.5, y: 0.4, visibility: 1 }; // nariz
  points[7] = { x: 0.4, y: 0.4, visibility: 1 }; // oreja izquierda
  points[8] = { x: 0.6, y: 0.4, visibility: 1 }; // oreja derecha
  points[11] = { x: 0.35, y: 0.6, visibility: 1 }; // hombro izquierdo
  points[12] = { x: 0.65, y: 0.6, visibility: 1 }; // hombro derecho
  points[15] = { x: 0.3, y: 0.8, visibility: 1 }; // muñeca izquierda
  points[16] = { x: 0.7, y: 0.8, visibility: 1 }; // muñeca derecha
  return points;
};

// Tracker listo con dobles ya cargados (equivale a un `load()` terminado).
const makeReadyTracker = ({ face = null } = {}) => {
  const tracker = new PoseTracker(fakeVideo);
  tracker.ready = true;
  tracker.canvas = fakeCanvas();
  tracker.landmarker = { detectForVideo: () => ({ landmarks: [bodyLandmarks()] }) };
  tracker.faceLandmarker = face;
  return tracker;
};

const faceWithSmile = () => ({
  detectForVideo: () => ({
    faceBlendshapes: [
      {
        categories: [
          { categoryName: 'mouthSmileLeft', score: 0.9 },
          { categoryName: 'mouthSmileRight', score: 0.9 },
          { categoryName: 'eyeLookOutLeft', score: 0 },
          { categoryName: 'eyeLookInRight', score: 0 },
          { categoryName: 'eyeLookInLeft', score: 0 },
          { categoryName: 'eyeLookOutRight', score: 0 },
          { categoryName: 'eyeLookUpLeft', score: 0 },
          { categoryName: 'eyeLookUpRight', score: 0 },
          { categoryName: 'eyeLookDownLeft', score: 0 },
          { categoryName: 'eyeLookDownRight', score: 0 },
        ],
      },
    ],
  }),
});

// --- C2: contrato de carga ---------------------------------------------------------------------

test('load({ face: false }) carga SOLO el modelo corporal', async () => {
  const { deps, calls, attempts } = mediapipeDeps();
  const tracker = new PoseTracker(fakeVideo);

  const ok = await tracker.load({ face: false, deps });

  assert.equal(ok, true);
  assert.equal(tracker.ready, true);
  assert.equal(tracker.faceLandmarker, null, 'no se crea FaceLandmarker');
  assert.deepEqual(attempts, ['pose:GPU'], 'sólo se intenta el modelo corporal');
  assert.deepEqual(calls, [], 'no se cierra nada todavía');
});

test('load() sin argumentos mantiene el comportamiento de la entrevista (cuerpo + rostro)', async () => {
  const { deps, attempts } = mediapipeDeps();
  const tracker = new PoseTracker(fakeVideo);

  const ok = await tracker.load({ deps });

  assert.equal(ok, true);
  assert.notEqual(tracker.faceLandmarker, null, 'la entrevista sigue inicializando el rostro');
  assert.deepEqual(attempts, ['pose:GPU', 'face:GPU']);
});

test('la configuración del modelo corporal no cambia (VIDEO, una pose, lite float16)', async () => {
  const captured = [];
  const deps = {
    FilesetResolver: { forVisionTasks: async () => ({}) },
    PoseLandmarker: {
      createFromOptions: async (vision, options) => {
        captured.push(options);
        return makeLandmarker('pose', []);
      },
    },
    FaceLandmarker: { createFromOptions: async () => makeLandmarker('face', []) },
  };
  await new PoseTracker(fakeVideo).load({ face: false, deps });

  assert.equal(captured.length, 1);
  assert.equal(captured[0].runningMode, 'VIDEO');
  assert.equal(captured[0].numPoses, 1);
  assert.equal(captured[0].baseOptions.delegate, 'GPU');
  assert.match(captured[0].baseOptions.modelAssetPath, /pose_landmarker_lite\/float16/);
});

test('si la GPU falla en el modelo corporal, se reintenta con CPU', async () => {
  const { deps, attempts } = mediapipeDeps({ failGpu: true });
  const tracker = new PoseTracker(fakeVideo);
  await tracker.load({ face: false, deps });
  assert.deepEqual(attempts, ['pose:GPU', 'pose:CPU']);
  assert.equal(tracker.ready, true);
});

test('si el modelo corporal no carga, ready queda en false y no se pide el rostro', async () => {
  const { deps, attempts, calls } = mediapipeDeps({ failAll: true });
  const tracker = new PoseTracker(fakeVideo);
  const ok = await tracker.load({ face: false, deps });
  assert.equal(ok, false);
  assert.equal(tracker.ready, false);
  assert.equal(tracker.faceLandmarker, undefined, 'ni siquiera se intenta el rostro');
  assert.deepEqual(attempts, ['pose:GPU', 'pose:CPU']);
  assert.deepEqual(calls, []);
});

test('con rostro pedido, si el rostro falla la medición corporal continúa', async () => {
  const { deps } = mediapipeDeps({ failFace: true });
  const tracker = new PoseTracker(fakeVideo);
  const ok = await tracker.load({ deps });
  assert.equal(ok, true, 'el cuerpo sí cargó');
  assert.equal(tracker.faceLandmarker, null, 'el rostro queda desactivado sin romper nada');
});

// --- medición con y sin FaceLandmarker ---------------------------------------------------------

// Avanza un cuadro simulando un hueco realista (≈400 ms) para que los tiempos medidos no sean cero.
const step = (tracker, ms = 400) => {
  tracker.lastFrameAt = performance.now() - ms;
  tracker.analyze();
};

test('sin FaceLandmarker la medición corporal funciona igual (presencia, mirada, iluminación)', () => {
  const tracker = makeReadyTracker({ face: null });
  for (let i = 0; i < 10; i += 1) step(tracker);

  assert.equal(tracker.stats.frames, 10);
  assert.equal(tracker.faceFrames, 0, 'sin rostro no hay cuadros faciales');
  assert.equal(tracker.personNow, true, 'la presencia se mide con el cuerpo');
  assert.ok(tracker.time.facing > 0, 'la mirada al frente se calcula con el pose');
  assert.equal(tracker.time.smile, 0);
  const summary = tracker.summary();
  assert.equal(summary.body.available, true);
  assert.equal(summary.body.faceAvailable, false, 'el informe sabrá que no hay datos de rostro');
  assert.equal(summary.body.smileSeconds, 0);
  assert.ok(summary.lighting.average > 0);
  assert.equal(tracker.readFace(0), null, 'readFace es seguro sin rostro');
  assert.equal(tracker.endSegment(), null, 'sin beginSegment no hay tramo');
});

test('con FaceLandmarker el comportamiento es el de la entrevista (risa y mirada)', () => {
  const tracker = makeReadyTracker({ face: faceWithSmile() });
  tracker.beginSegment();
  for (let i = 0; i < 10; i += 1) step(tracker);

  assert.ok(tracker.faceFrames >= 10, 'se cuentan los cuadros con rostro');
  assert.ok(tracker.time.smile > 0, 'se acumula el tiempo sonriendo');
  const segment = tracker.endSegment();
  assert.ok(segment.smileSeconds > 0);
  assert.equal(tracker.summary().body.faceAvailable, true);
});

test('un rostro disponible pero sin detección no rompe la medición', () => {
  const tracker = makeReadyTracker({ face: { detectForVideo: () => ({ faceBlendshapes: [] }) } });
  for (let i = 0; i < 3; i += 1) step(tracker);
  assert.equal(tracker.readFace(0), null);
  assert.equal(tracker.faceFrames, 0);
  assert.equal(tracker.personNow, true);
});

test('el análisis se atrasa: ningún cuadro acumula más de 500 ms', () => {
  const tracker = makeReadyTracker();
  step(tracker);
  const before = tracker.time.analyzed;
  tracker.lastFrameAt = performance.now() - 5000; // hueco enorme entre cuadros
  tracker.analyze();
  // El reloj del navegador es fraccionario: se compara con tolerancia de una milésima.
  assert.ok(Math.abs(tracker.time.analyzed - before - 500) < 0.001, 'se aplica MAX_FRAME_GAP_MS');
});

test('start, reset, stop y destroy son seguros sin FaceLandmarker', async () => {
  const { deps, calls } = mediapipeDeps();
  const tracker = new PoseTracker(fakeVideo);
  await tracker.load({ face: false, deps });

  // `start()` necesita un DOM mínimo: el bucle usa un canvas 32×18 sólo para la iluminación.
  const previousDocument = globalThis.document;
  globalThis.document = { createElement: () => fakeCanvas() };
  try {
    tracker.start();
    assert.equal(tracker.running, true);
    tracker.reset();
    assert.equal(tracker.personNow, false);
    tracker.stop();
    assert.equal(tracker.running, false);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }

  tracker.destroy();
  assert.ok(calls.includes('close:pose'), 'se cierra el modelo corporal');
  assert.ok(!calls.some((c) => c.startsWith('close:face')), 'no hay rostro que cerrar');
});

// --- contrato de la entrevista (sin cambios) ---------------------------------------------------

test('la entrevista sigue llamando load() sin argumentos y no pide face:false', () => {
  const source = readFileSync(new URL('../../pages/SesionPractica.jsx', import.meta.url), 'utf8');
  assert.match(source, /pose\.load\(\)/, 'la entrevista carga el tracker sin argumentos');
  assert.doesNotMatch(source, /face:\s*false/, 'la entrevista no desactiva el rostro');
});

test('el valor por defecto de face en load() es true', () => {
  const source = readFileSync(new URL('./poseTracker.js', import.meta.url), 'utf8');
  assert.match(source, /async load\(\{ face = true, deps = null \} = \{\}\)/);
});
