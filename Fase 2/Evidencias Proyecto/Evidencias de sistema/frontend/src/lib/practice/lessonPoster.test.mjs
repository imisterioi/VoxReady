// Portadas de las microlecciones: la de YouTube se deriva del identificador validado y el fotograma
// del archivo se extrae en el navegador. Aquí se comprueba la parte pura (sin DOM).
import test from 'node:test';
import assert from 'node:assert/strict';
import { youtubePosterCandidates, extractVideoFrame } from './lessonPoster.js';

test('la portada de YouTube se construye solo con el identificador validado', () => {
  assert.deepEqual(youtubePosterCandidates('1vbWtbuC5TY'), [
    'https://i.ytimg.com/vi/1vbWtbuC5TY/maxresdefault.jpg',
    'https://i.ytimg.com/vi/1vbWtbuC5TY/hqdefault.jpg',
    'https://i.ytimg.com/vi/1vbWtbuC5TY/mqdefault.jpg',
  ]);
});

test('no se inventa una portada con identificadores inválidos ni con una URL completa', () => {
  const bad = [
    '', '   ', 'abc', '1vbWtbuC5TY&evil=1', '../../etc/passwd',
    'https://www.youtube.com/watch?v=1vbWtbuC5TY', 'https://i.ytimg.com/vi/1vbWtbuC5TY/hqdefault.jpg',
    null, undefined, 42, {},
  ];
  for (const value of bad) {
    assert.deepEqual(youtubePosterCandidates(value), [], `no debe aceptar: ${String(value)}`);
  }
});

test('la portada nunca arrastra parámetros del usuario', () => {
  const [first] = youtubePosterCandidates('m8jyYIZwc28');
  assert.equal(first, 'https://i.ytimg.com/vi/m8jyYIZwc28/maxresdefault.jpg');
  assert.ok(first.startsWith('https://i.ytimg.com/vi/'), 'siempre el origen de las portadas');
});

test('la calidad «sd» empieza en hqdefault (miniaturas) sin inventar rutas', () => {
  assert.deepEqual(youtubePosterCandidates('m8jyYIZwc28', { quality: 'sd' }), [
    'https://i.ytimg.com/vi/m8jyYIZwc28/hqdefault.jpg',
    'https://i.ytimg.com/vi/m8jyYIZwc28/mqdefault.jpg',
  ]);
  assert.deepEqual(youtubePosterCandidates('no-valido', { quality: 'sd' }), []);
});

test('extraer un fotograma no lanza ni rompe fuera del navegador', async () => {
  // Sin DOM disponible (Node) la función devuelve null en lugar de fallar.
  assert.equal(await extractVideoFrame(null), null);
  assert.equal(await extractVideoFrame('https://example.test/video.webm'), null);
});
