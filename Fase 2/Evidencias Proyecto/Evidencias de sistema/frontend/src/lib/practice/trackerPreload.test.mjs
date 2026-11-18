// Pruebas de la precarga del tracker (C1): sin navegador, sin red y sin MediaPipe real.
import test from 'node:test';
import assert from 'node:assert/strict';
import { TRACKER_STATES, createTrackerPreload } from './trackerPreload.js';

const deferred = () => {
  let resolve;
  const promise = new Promise((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

const makeTracker = ({ withDefer = false } = {}) => {
  const gate = withDefer ? deferred() : null;
  const calls = [];
  const tracker = {
    video: null,
    ready: false,
    running: false,
    personNow: false,
    calls,
    load(options = {}) {
      calls.push(`load:${options.face}`);
      if (gate) {
        return gate.promise.then((value) => {
          tracker.ready = value !== false;
          return value;
        });
      }
      tracker.ready = true;
      return Promise.resolve(true);
    },
    stop() {
      calls.push('stop');
      tracker.running = false;
    },
    start() {
      calls.push('start');
      tracker.running = true;
    },
    reset() {
      calls.push('reset');
      tracker.personNow = false;
    },
    destroy() {
      calls.push('destroy');
    },
  };
  return { tracker, gate, calls };
};

// Fábrica por defecto: crea dobles independientes por elemento <video>.
const build = (overrides = {}) => {
  const created = [];
  const states = [];
  const preload = createTrackerPreload({
    createTracker: (video) => {
      const made = makeTracker();
      made.tracker.video = video;
      created.push(made.tracker);
      return made.tracker;
    },
    onState: (state) => states.push(state),
    ...overrides,
  });
  return { preload, created, states };
};

test('carga una sola vez, sin rostro, y queda listo', async () => {
  const { preload, created, states } = build();
  const video = { id: 'v1' };
  const result = await preload.ensure(video, { face: false });

  assert.equal(created.length, 1, 'un único tracker');
  assert.deepEqual(created[0].calls, ['load:false'], 'la preparación no pide el modelo facial');
  assert.deepEqual(states, [TRACKER_STATES.loading, TRACKER_STATES.ready]);
  assert.equal(result.status, TRACKER_STATES.ready);
  assert.equal(result.reused, false);
  assert.equal(preload.isReady(), true);
  assert.equal(preload.current(), created[0]);
});

test('dos llamadas simultáneas comparten la MISMA carga (no se inicializa dos veces)', async () => {
  const made = makeTracker({ withDefer: true });
  let created = 0;
  const preload = createTrackerPreload({
    createTracker: (video) => {
      created += 1;
      made.tracker.video = video;
      return made.tracker;
    },
  });
  const video = { id: 'v1' };

  const first = preload.ensure(video, { face: false });
  const second = preload.ensure(video, { face: false });
  assert.equal(created, 1, 'sólo se crea un tracker');
  assert.equal(preload.status(), TRACKER_STATES.loading);

  made.gate.resolve(true);
  const [a, b] = await Promise.all([first, second]);
  assert.equal(created, 1);
  assert.equal(made.calls.filter((c) => c.startsWith('load')).length, 1, 'una sola carga');
  assert.equal(a.status, TRACKER_STATES.ready);
  assert.equal(b.status, TRACKER_STATES.ready);
  assert.ok(b.reused || a.reused, 'la segunda llamada reutiliza');
});

test('si cambia el elemento <video>, se destruye el tracker anterior', async () => {
  const { preload, created } = build();
  const v1 = { id: 'v1' };
  const v2 = { id: 'v2' };

  await preload.ensure(v1, { face: false });
  const first = created[0];
  const result = await preload.ensure(v2, { face: false });

  assert.equal(created.length, 2, 'se crea otro tracker para el vídeo nuevo');
  assert.ok(first.calls.includes('destroy'), 'el anterior se libera');
  assert.equal(result.reused, false);
  assert.equal(preload.current().video, v2);
});

test('un fallo de carga deja el estado en failed (sin excepciones ni carga permanente)', async () => {
  const states = [];
  const preload = createTrackerPreload({
    createTracker: (video) => {
      const t = makeTracker();
      t.video = video;
      t.load = () => Promise.resolve(false);
      return t;
    },
    onState: (s) => states.push(s),
  });
  const result = await preload.ensure({ id: 'v1' });
  assert.equal(result.status, TRACKER_STATES.failed);
  assert.equal(preload.isReady(), false);
  assert.deepEqual(states, [TRACKER_STATES.loading, TRACKER_STATES.failed]);
});

test('un rechazo de load() también termina en failed', async () => {
  const preload = createTrackerPreload({
    createTracker: (video) => {
      const t = makeTracker();
      t.video = video;
      t.load = () => Promise.reject(new Error('sin red'));
      return t;
    },
  });
  const result = await preload.ensure({ id: 'v1' });
  assert.equal(result.status, TRACKER_STATES.failed, 'no se queda cargando');
});


test('desmontaje durante la carga: los recursos que llegan tarde se destruyen y no queda "loading"', async () => {
  const made = makeTracker({ withDefer: true });
  const states = [];
  const preload = createTrackerPreload({
    createTracker: (video) => {
      made.tracker.video = video;
      return made.tracker;
    },
    onState: (s) => states.push(s),
  });

  const pending = preload.ensure({ id: 'v1' }, { face: false });
  assert.equal(preload.status(), TRACKER_STATES.loading);

  preload.dispose();
  assert.equal(preload.status(), TRACKER_STATES.idle, 'no queda un estado de carga permanente');
  assert.equal(preload.current(), null);

  made.gate.resolve(true);
  await pending;
  assert.ok(made.calls.includes('destroy'), 'el tracker que llegó tarde se cierra');
  assert.equal(preload.status(), TRACKER_STATES.idle, 'no vuelve a ready tras el desmontaje');
  assert.equal(preload.isReady(), false);
});

test('desmontaje con el tracker ya cargado: se destruye de inmediato', async () => {
  const { preload, created } = build();
  await preload.ensure({ id: 'v1' });
  const tracker = created[0];

  preload.dispose();
  assert.ok(tracker.calls.includes('destroy'));
  assert.equal(preload.current(), null);
  assert.equal(preload.status(), TRACKER_STATES.idle);
});

test('después del desmontaje no se crea nada nuevo', async () => {
  const { preload, created } = build();
  preload.dispose();
  const result = await preload.ensure({ id: 'v1' });
  assert.equal(created.length, 0, 'no se inicializa nada tras el desmontaje');
  assert.equal(result.tracker, null);
});

test('sin elemento vídeo no se inicializa nada', async () => {
  const { preload, created, states } = build();
  const result = await preload.ensure(null);
  assert.equal(created.length, 0);
  assert.deepEqual(states, [], 'el estado no cambia');
  assert.equal(result.status, TRACKER_STATES.idle);
});

test('beginRun prepara el tracker para una medición nueva (sin datos previos)', async () => {
  const { preload, created } = build();
  assert.equal(preload.beginRun(), false, 'sin tracker no hay nada que reiniciar');

  await preload.ensure({ id: 'v1' });
  const tracker = created[0];
  tracker.calls.length = 0;
  assert.equal(preload.beginRun(), true);
  assert.deepEqual(tracker.calls, ['stop', 'reset', 'start'], 'detiene, limpia y vuelve a medir');
  assert.equal(tracker.personNow, false);
});

test('stop() detiene la medición sin destruir el tracker', async () => {
  const { preload, created } = build();
  await preload.ensure({ id: 'v1' });
  const tracker = created[0];
  tracker.running = true;
  tracker.personNow = true;
  tracker.calls.length = 0;

  assert.equal(preload.stop(), true);
  assert.equal(tracker.running, false);
  assert.equal(tracker.personNow, false);
  assert.deepEqual(tracker.calls, ['stop']);
  assert.equal(preload.current(), tracker, 'sigue disponible para la siguiente calibración');
});

test('onState sólo informa de transiciones reales y el mismo <video> no se recarga', async () => {
  const { preload, states, created } = build();
  const video = { id: 'v1' }; // el MISMO nodo en las tres llamadas
  await preload.ensure(video);
  await preload.ensure(video);
  await preload.ensure(video);
  assert.equal(created.length, 1, 'no se vuelve a inicializar el mismo vídeo');
  assert.deepEqual(states, [TRACKER_STATES.loading, TRACKER_STATES.ready], 'sin repeticiones');
});

test('la carga se pide sin rostro por defecto (la calibración no lo necesita)', async () => {
  const { preload, created } = build();
  await preload.ensure({ id: 'v1' });
  assert.deepEqual(created[0].calls, ['load:false']);
});

test('si createTracker lanza, se informa failed sin propagar el error', async () => {
  const preload = createTrackerPreload({
    createTracker: () => {
      throw new Error('no se pudo crear');
    },
  });
  const result = await preload.ensure({ id: 'v1' });
  assert.equal(result.status, TRACKER_STATES.failed);
  assert.equal(preload.current(), null);
});
