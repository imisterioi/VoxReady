// URL del video protegido de una microlección.
import test from 'node:test';
import assert from 'node:assert/strict';
import { lessonVideoUrl, parseLessonVideoUrl } from './lessonVideo.js';

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

// ---------------------------------------------------- Enlaces externos (YouTube)

test('acepta los enlaces habituales de YouTube y los transforma en reproducción integrada', () => {
  const cases = [
    ['https://www.youtube.com/watch?v=1vbWtbuC5TY', '1vbWtbuC5TY'],
    ['https://youtube.com/watch?v=1vbWtbuC5TY&t=30s', '1vbWtbuC5TY'],
    ['https://youtu.be/1vbWtbuC5TY', '1vbWtbuC5TY'],
    ['https://youtu.be/1vbWtbuC5TY?si=abcd', '1vbWtbuC5TY'],
    ['https://www.youtube.com/shorts/TJAbOeb7NEA', 'TJAbOeb7NEA'],
    ['https://m.youtube.com/watch?v=1vbWtbuC5TY', '1vbWtbuC5TY'],
    ['https://www.youtube.com/embed/m8jyYIZwc28', 'm8jyYIZwc28'],
    ['https://music.youtube.com/watch?v=1vbWtbuC5TY', '1vbWtbuC5TY'],
  ];
  for (const [input, id] of cases) {
    const parsed = parseLessonVideoUrl(input);
    assert.ok(parsed, `debe aceptar ${input}`);
    assert.equal(parsed.videoId, id);
    assert.equal(parsed.embedUrl, `https://www.youtube-nocookie.com/embed/${id}?rel=0`);
    assert.equal(parsed.watchUrl, `https://www.youtube.com/watch?v=${id}`);
  }
});

test('rechaza enlaces inválidos o inseguros (nunca se reproduce contenido arbitrario)', () => {
  const bad = [
    'http://www.youtube.com/watch?v=1vbWtbuC5TY', // sin HTTPS
    'javascript:alert(document.cookie)',
    'data:text/html,<iframe src=x></iframe>',
    'https://evil.example/watch?v=1vbWtbuC5TY',
    'https://youtube.com.evil.example/watch?v=1vbWtbuC5TY', // dominio que solo lo parece
    'https://vimeo.com/123456789',
    'https://www.youtube.com/watch?v=abc',
    'https://www.youtube.com/watch',
    'no es una url',
    '',
    null,
    undefined,
  ];
  for (const input of bad) {
    assert.equal(parseLessonVideoUrl(input), null, `debe rechazar: ${input}`);
  }
});

test('la reproducción integrada no incrusta la URL del usuario ni la abre sola', () => {
  const raw = 'https://www.youtube.com/watch?v=1vbWtbuC5TY&autoplay=1&evil=<script>';
  const parsed = parseLessonVideoUrl(raw);
  assert.ok(parsed);
  assert.equal(parsed.embedUrl, 'https://www.youtube-nocookie.com/embed/1vbWtbuC5TY?rel=0');
  assert.ok(!parsed.embedUrl.includes('evil'), 'no arrastra parámetros del usuario');
  assert.ok(!parsed.embedUrl.includes('<script>'));
  assert.ok(parsed.embedUrl.startsWith('https://www.youtube-nocookie.com/embed/'), 'solo el origen de inserción');
});
