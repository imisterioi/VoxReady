// Pruebas de la captura de medios (sin navegador: se inyectan factorías falsas).
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AUDIO_MIME_CANDIDATES,
  audioOnlyStream,
  buildBlob,
  pickSupportedMime,
  startAudioRecorder,
  stopAll,
  stopAndWait,
  uploadBlob,
} from './mediaCapture.js';

// ------------------------------------------------------------ dobles

class FakeTrack {
  constructor(kind = 'audio', readyState = 'live') {
    this.kind = kind;
    this.readyState = readyState;
  }
}

class FakeStream {
  constructor(tracks = []) {
    this.tracks = tracks;
  }
  getTracks() {
    return this.tracks;
  }
  getAudioTracks() {
    return this.tracks.filter((track) => track.kind === 'audio');
  }
}

class FakeBlob {
  constructor(parts = [], options = {}) {
    this.parts = parts;
    this.size = parts.reduce((sum, part) => sum + (part?.size ?? part?.length ?? 0), 0);
    this.type = options.type;
  }
}

class FakeRecorder {
  static supported = ['audio/webm;codecs=opus', 'audio/webm'];
  static failStart = null;
  static last = null;

  static isTypeSupported(mime) {
    return FakeRecorder.supported.includes(mime);
  }

  constructor(stream, options) {
    this.stream = stream;
    this.options = options;
    this.state = 'inactive';
    this.listeners = {};
    FakeRecorder.last = { stream, options };
  }

  addEventListener(type, handler) {
    (this.listeners[type] ||= []).push(handler);
  }

  start(timeslice) {
    if (FakeRecorder.failStart) throw FakeRecorder.failStart;
    this.timeslice = timeslice;
    this.state = 'recording';
  }

  stop() {
    this.state = 'inactive';
    // El navegador emite el dataavailable final ANTES del stop.
    this.ondataavailable?.({ data: { size: 7 } });
    this.onstop?.();
    for (const handler of this.listeners.stop || []) handler();
  }
}

const audioVideoStream = () => new FakeStream([new FakeTrack('audio'), new FakeTrack('video')]);

// ------------------------------------------------------------ MIME

test('pickSupportedMime devuelve el primero soportado, en orden', () => {
  assert.equal(pickSupportedMime((m) => m === 'audio/webm'), 'audio/webm');
  assert.equal(pickSupportedMime(() => true), AUDIO_MIME_CANDIDATES[0]);
  assert.equal(pickSupportedMime(() => false), null);
  assert.equal(pickSupportedMime(undefined), null);
  assert.equal(
    pickSupportedMime(() => {
      throw new Error('boom');
    }),
    null,
  );
});

// ------------------------------------------------------------ stream solo-audio

test('audioOnlyStream deja SOLO la pista de audio (corrección del fallo reproducido)', () => {
  const stream = audioOnlyStream(audioVideoStream(), FakeStream);
  assert.equal(stream.getTracks().length, 1);
  assert.equal(stream.getTracks()[0].kind, 'audio');
  assert.deepEqual(stream.getAudioTracks().map((t) => t.kind), ['audio']);
});

test('audioOnlyStream ignora pistas terminadas y falla si no queda audio', () => {
  const ended = new FakeStream([new FakeTrack('audio', 'ended'), new FakeTrack('video')]);
  assert.throws(() => audioOnlyStream(ended, FakeStream), (error) => error.code === 'AUDIO_TRACK_MISSING');
  const none = new FakeStream([]);
  assert.throws(() => audioOnlyStream(none, FakeStream), (error) => error.code === 'AUDIO_TRACK_MISSING');
});

// ------------------------------------------------------------ grabador

test('startAudioRecorder construye el grabador con un stream SIN video', () => {
  const { recorder, stream, mime } = startAudioRecorder({
    stream: audioVideoStream(),
    MediaRecorderCtor: FakeRecorder,
    StreamCtor: FakeStream,
  });
  assert.equal(mime, 'audio/webm;codecs=opus');
  assert.equal(recorder.state, 'recording');
  assert.equal(FakeRecorder.last.stream.getTracks().length, 1);
  assert.equal(FakeRecorder.last.stream.getTracks()[0].kind, 'audio');
  assert.equal(FakeRecorder.last.options.mimeType, 'audio/webm;codecs=opus');
  assert.equal(FakeRecorder.last.options.audioBitsPerSecond, 32000);
  assert.equal(stream.getTracks().length, 1);
});

test('startAudioRecorder entrega los fragmentos al callback', () => {
  const chunks = [];
  const { recorder } = startAudioRecorder({
    stream: audioVideoStream(),
    MediaRecorderCtor: FakeRecorder,
    StreamCtor: FakeStream,
    onData: (data) => chunks.push(data.size),
  });
  recorder.ondataavailable({ data: { size: 12 } });
  recorder.ondataavailable({ data: { size: 0 } }); // vacío: se ignora
  assert.deepEqual(chunks, [12]);
});

test('startAudioRecorder falla con código si el MIME no está soportado', () => {
  assert.throws(
    () =>
      startAudioRecorder({
        stream: audioVideoStream(),
        MediaRecorderCtor: FakeRecorder,
        isSupported: () => false,
        StreamCtor: FakeStream,
      }),
    (error) => error.code === 'AUDIO_MIME_UNSUPPORTED',
  );
});

test('startAudioRecorder informa el error real de start() (NotSupportedError)', () => {
  FakeRecorder.failStart = Object.assign(new Error('There was an error starting the MediaRecorder'), {
    name: 'NotSupportedError',
  });
  try {
    assert.throws(
      () =>
        startAudioRecorder({
          stream: audioVideoStream(),
          MediaRecorderCtor: FakeRecorder,
          StreamCtor: FakeStream,
        }),
      (error) => error.code === 'AUDIO_RECORDER_START_FAILED' && error.cause?.name === 'NotSupportedError',
    );
  } finally {
    FakeRecorder.failStart = null;
  }
});

// ------------------------------------------------------------ parada ordenada

test('stopAndWait espera al evento stop y el dataavailable final llega antes', async () => {
  const order = [];
  const { recorder } = startAudioRecorder({
    stream: audioVideoStream(),
    MediaRecorderCtor: FakeRecorder,
    StreamCtor: FakeStream,
    onData: () => order.push('dataavailable'),
  });
  const stopped = stopAndWait(recorder).then(() => order.push('stop-resuelto'));
  await stopped;
  assert.deepEqual(order, ['dataavailable', 'stop-resuelto']);
  assert.equal(recorder.state, 'inactive');
});

test('stopAndWait sobre un grabador ya inactivo no se queda colgado', async () => {
  assert.equal(await stopAndWait(null), false);
  assert.equal(await stopAndWait({ state: 'inactive' }), false);
});

test('stopAll solo detiene los grabadores activos y no lanza con los cerrados', () => {
  const activo = { state: 'recording', stop() { this.state = 'inactive'; } };
  const inactivo = { state: 'inactive', stop() { throw new Error('no debería llamarse'); } };
  const roto = { state: 'recording', stop() { throw new Error('fallo del navegador'); } };
  // El que lanza no cuenta como detenido, pero tampoco interrumpe al resto.
  assert.equal(stopAll([activo, inactivo, null, roto]), 1);
  assert.equal(activo.state, 'inactive');
  assert.equal(roto.state, 'recording');
  assert.equal(stopAll(), 0);
});

// ------------------------------------------------------------ Blob

test('buildBlob conserva los fragmentos y el tipo', () => {
  const blob = buildBlob([{ size: 10 }, { size: 5 }], 'audio/webm', FakeBlob);
  assert.equal(blob.size, 15);
  assert.equal(blob.type, 'audio/webm');
  assert.equal(buildBlob(undefined, 'audio/webm', FakeBlob).size, 0);
});

// ------------------------------------------------------------ subida

test('uploadBlob NO envía nada si el Blob está vacío', async () => {
  let called = false;
  const result = await uploadBlob({
    url: '/api/sessions/s1/audio',
    blob: new FakeBlob([], { type: 'audio/webm' }),
    type: 'audio/webm',
    fetchImpl: async () => {
      called = true;
      return { ok: true, status: 200 };
    },
  });
  assert.deepEqual(result, { ok: false, reason: 'EMPTY', bytes: 0 });
  assert.equal(called, false);
});

test('uploadBlob detecta una respuesta HTTP fallida', async () => {
  const result = await uploadBlob({
    url: '/audio',
    blob: new FakeBlob([{ size: 128 }], { type: 'audio/webm' }),
    type: 'audio/webm',
    fetchImpl: async () => ({ ok: false, status: 415 }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'HTTP');
  assert.equal(result.status, 415);
});

test('uploadBlob distingue un fallo de red', async () => {
  const result = await uploadBlob({
    url: '/audio',
    blob: new FakeBlob([{ size: 128 }], { type: 'audio/webm' }),
    type: 'audio/webm',
    fetchImpl: async () => {
      throw Object.assign(new Error('offline'), { name: 'TypeError' });
    },
  });
  assert.equal(result.reason, 'NETWORK');
  assert.equal(result.error, 'TypeError');
});

test('uploadBlob devuelve éxito con bytes y estado', async () => {
  let seen = null;
  const result = await uploadBlob({
    url: '/audio',
    blob: new FakeBlob([{ size: 256 }], { type: 'audio/webm' }),
    type: 'audio/webm',
    fetchImpl: async (url, options) => {
      seen = { url, options };
      return { ok: true, status: 200 };
    },
  });
  assert.deepEqual(result, { ok: true, status: 200, bytes: 256 });
  assert.equal(seen.options.method, 'POST');
  assert.equal(seen.options.headers['Content-Type'], 'audio/webm');
});

test('uploadBlob con parseJson devuelve el cuerpo de la transcripción', async () => {
  const result = await uploadBlob({
    url: '/answer-transcript',
    blob: new FakeBlob([{ size: 128 }], { type: 'audio/webm' }),
    type: 'audio/webm',
    parseJson: true,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ status: 'ok', text: 'avisamos a la autoridad', engine: 'nvidia-whisper-large-v3', code: null }),
    }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.body.text, 'avisamos a la autoridad');
  assert.equal(result.bytes, 128);
});

test('uploadBlob con parseJson y cuerpo ilegible no rompe la subida', async () => {
  const result = await uploadBlob({
    url: '/answer-transcript',
    blob: new FakeBlob([{ size: 64 }], { type: 'audio/webm' }),
    type: 'audio/webm',
    parseJson: true,
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => { throw new Error('sin cuerpo'); } }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.body, null);
});

test('uploadBlob propaga el signal cuando se acota la espera', async () => {
  let seen = null;
  const controller = new AbortController();
  await uploadBlob({
    url: '/answer-transcript',
    blob: new FakeBlob([{ size: 64 }], { type: 'audio/webm' }),
    type: 'audio/webm',
    signal: controller.signal,
    fetchImpl: async (url, options) => {
      seen = options;
      return { ok: true, status: 200 };
    },
  });
  assert.equal(seen.signal, controller.signal);
  // Sin signal no se añade la clave (comportamiento anterior intacto).
  let sinSignal = null;
  await uploadBlob({
    url: '/audio',
    blob: new FakeBlob([{ size: 64 }], { type: 'audio/webm' }),
    type: 'audio/webm',
    fetchImpl: async (url, options) => {
      sinSignal = options;
      return { ok: true, status: 200 };
    },
  });
  assert.equal('signal' in sinSignal, false);
});


// ------------------------------------------------------------ orden completo

test('el flujo termina el grabador, construye el Blob y sube ANTES de evaluar', async () => {
  const order = [];
  const chunks = [];
  const { recorder } = startAudioRecorder({
    stream: audioVideoStream(),
    MediaRecorderCtor: FakeRecorder,
    StreamCtor: FakeStream,
    onData: (data) => {
      chunks.push(data);
      order.push('dataavailable');
    },
  });
  // el usuario termina: se para y se espera
  await stopAndWait(recorder);
  order.push('grabador-detendido');
  const blob = buildBlob(chunks, 'audio/webm', FakeBlob);
  assert.ok(blob.size > 0);

  const video = await uploadBlob({
    url: '/video',
    blob: new FakeBlob([{ size: 999 }], { type: 'video/webm' }),
    type: 'video/webm',
    fetchImpl: async () => {
      order.push('subida-video');
      return { ok: true, status: 200 };
    },
  });
  const audio = await uploadBlob({
    url: '/audio',
    blob,
    type: 'audio/webm',
    fetchImpl: async () => {
      order.push('subida-audio');
      return { ok: true, status: 200 };
    },
  });
  order.push('evaluate');

  assert.equal(video.ok, true);
  assert.equal(audio.ok, true);
  assert.deepEqual(order, ['dataavailable', 'grabador-detendido', 'subida-video', 'subida-audio', 'evaluate']);
});

