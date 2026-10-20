import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { sessionVideoUrl } from './sessionVideo.js';

const here = path.dirname(fileURLToPath(import.meta.url));

const opts = { apiUrl: 'http://api', token: 'tkn' };

test('la URL del vídeo contiene exactamente el id de la sesión consultada', () => {
  const a = sessionVideoUrl('sesion-A', opts);
  const b = sessionVideoUrl('sesion-B', opts);
  assert.match(a, /\/api\/sessions\/sesion-A\/video\?/);
  assert.match(b, /\/api\/sessions\/sesion-B\/video\?/);
  assert.notEqual(a, b);
  assert.ok(!a.includes('sesion-B'));
  assert.ok(!b.includes('sesion-A'));
});

test('sin apiUrl no hay URL (no se inventa un destino)', () => {
  assert.equal(sessionVideoUrl('s1', { token: 't' }), null);
});

test('sin id no hay URL (nunca se usa el vídeo de otra sesión)', () => {
  assert.equal(sessionVideoUrl('', opts), null);
  assert.equal(sessionVideoUrl(null, opts), null);
  assert.equal(sessionVideoUrl(undefined, opts), null);
});

test('el id y el token viajan codificados', () => {
  const url = sessionVideoUrl('a/b c', { apiUrl: 'http://api', token: 'x y' });
  assert.ok(url.includes('/sessions/a%2Fb%20c/video'));
  assert.ok(url.includes('token=x%20y'));
});

test('el mismo id produce siempre la misma URL (sin estado compartido)', () => {
  assert.equal(sessionVideoUrl('s1', opts), sessionVideoUrl('s1', opts));
});

test('el reproductor oculta la descarga, conserva los controles y no invierte la imagen', () => {
  const file = fs.readFileSync(path.join(here, '../../components/SessionVideo.jsx'), 'utf8');
  assert.match(file, /controlsList="nodownload/);
  assert.match(file, /\bcontrols\b/);
  assert.match(file, /onContextMenu/);
  assert.doesNotMatch(file, /scale-x/); // el espejo es solo de la vista previa
});
