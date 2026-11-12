// URL del video protegido de una microlección.
import test from 'node:test';
import assert from 'node:assert/strict';
import { lessonVideoUrl } from './lessonVideo.js';

test('la URL del video apunta a la ruta protegida del backend', () => {
  const url = lessonVideoUrl('abc-123', { apiUrl: 'https://vox.example', token: 'tok en' });
  assert.equal(url, 'https://vox.example/api/micro-lessons/abc-123/video?token=tok%20en');
  assert.ok(url.includes('/api/micro-lessons/'), 'usa la ruta de microlecciones');
  assert.ok(!/youtube|youtu\.be|vimeo/.test(url), 'nunca un enlace externo');
});

test('sin id o sin apiUrl no hay URL (no se inventa un recurso)', () => {
  assert.equal(lessonVideoUrl(null, { apiUrl: 'https://vox.example', token: 't' }), null);
  assert.equal(lessonVideoUrl('abc', { token: 't' }), null);
  assert.equal(lessonVideoUrl('abc', { apiUrl: 'https://vox.example' }), 'https://vox.example/api/micro-lessons/abc/video?token=');
});

test('el identificador viaja codificado (no se puede romper la ruta)', () => {
  const url = lessonVideoUrl('a/b?c', { apiUrl: 'https://vox.example', token: 't' });
  assert.ok(url.includes('/api/micro-lessons/a%2Fb%3Fc/video'), url);
});
