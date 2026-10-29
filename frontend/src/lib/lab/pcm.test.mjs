import assert from 'node:assert/strict';
import test from 'node:test';

import { createPcmCollector, encodeWav } from './pcm.js';

const readWav = async (blob) => new Uint8Array(await blob.arrayBuffer());

test('encodeWav escribe una cabecera RIFF/WAVE PCM mono de 16 bits válida', async () => {
  const blob = encodeWav(new Float32Array(100), 16000);
  assert.equal(blob.type, 'audio/wav');
  const bytes = await readWav(blob);
  const ascii = (from, to) => String.fromCharCode(...bytes.slice(from, to));
  const u32 = (at) => new DataView(bytes.buffer).getUint32(at, true);
  const u16 = (at) => new DataView(bytes.buffer).getUint16(at, true);

  assert.equal(ascii(0, 4), 'RIFF');
  assert.equal(ascii(8, 12), 'WAVE');
  assert.equal(ascii(12, 16), 'fmt ');
  assert.equal(ascii(36, 40), 'data');
  assert.equal(u16(20), 1, 'PCM entero');
  assert.equal(u16(22), 1, 'mono');
  assert.equal(u32(24), 16000);
  assert.equal(u16(34), 16);
  assert.equal(bytes.length, 44 + 200);
  assert.equal(u32(40), 200, 'tamaño de data');
  assert.equal(u32(4), bytes.length - 8);
});

test('encodeWav recorta muestras fuera de rango sin desbordar', async () => {
  const bytes = await readWav(encodeWav(new Float32Array([2, -2, 0]), 8000));
  const view = new DataView(bytes.buffer);
  assert.equal(view.getInt16(44, true), 32767);
  assert.equal(view.getInt16(46, true), -32768);
  assert.equal(view.getInt16(48, true), 0);
});

test('encodeWav rechaza parámetros inválidos', () => {
  assert.throws(() => encodeWav(null, 16000));
  assert.throws(() => encodeWav(new Float32Array(1), 0));
});

test('el colector emite fragmentos exactos y conserva el resto hasta flush', () => {
  const emitted = [];
  const collector = createPcmCollector({ sampleRate: 1000, chunkSeconds: 1, onChunk: (c) => emitted.push(c) });

  collector.push(new Float32Array(600)); // 600 ms: aún no hay fragmento
  assert.equal(emitted.length, 0);
  assert.equal(collector.pendingMs, 600);

  collector.push(new Float32Array(600)); // completa 1000 + 200 de resto
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].durationMs, 1000);
  assert.equal(emitted[0].offsetMs, 0);
  assert.equal(collector.pendingMs, 200);

  collector.flush();
  assert.equal(emitted.length, 2);
  assert.equal(emitted[1].durationMs, 200);
  assert.equal(emitted[1].offsetMs, 1000, 'el resto empieza donde terminó el anterior');
  assert.equal(collector.capturedMs, 1200);
  assert.equal(collector.chunks, 2);
});

test('el colector no pierde muestras ni duplica entre fragmentos', () => {
  const emitted = [];
  const collector = createPcmCollector({ sampleRate: 100, chunkSeconds: 1, onChunk: (c) => emitted.push(c) });
  const input = Float32Array.from({ length: 250 }, (_, i) => i);
  collector.push(input);
  collector.flush();

  const joined = emitted.flatMap((c) => Array.from(c.samples));
  assert.equal(joined.length, 250, 'todas las muestras llegan una sola vez');
  assert.deepEqual(joined.slice(0, 5), [0, 1, 2, 3, 4]);
  assert.equal(joined[99], 99, 'el corte cae exactamente en 1 s');
  assert.equal(joined[100], 100);
});

test('el colector ignora entradas vacías y valida la frecuencia', () => {
  const collector = createPcmCollector({ sampleRate: 8000, chunkSeconds: 1 });
  collector.push(null);
  collector.push(new Float32Array(0));
  assert.equal(collector.capturedMs, 0);
  assert.throws(() => createPcmCollector({ sampleRate: 0 }), /frecuencia/);
});
