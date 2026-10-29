import assert from 'node:assert/strict';
import test from 'node:test';

import { analyticsPath, progressPath } from './progressSource.js';

// El vocero consulta SIEMPRE lo suyo: la vista nunca añade `?userId=` por su cuenta.
test('el vocero consulta su propio historial', () => {
  assert.equal(progressPath({ limit: null }), '/api/sessions');
  assert.equal(progressPath({ audience: 'user', limit: null }), '/api/sessions');
  // Aunque llegara un identificador por la ruta, la audiencia del vocero lo ignora.
  assert.equal(progressPath({ audience: 'user', userId: 'u-9', limit: null }), '/api/sessions');
});

test('el administrador consulta al vocero indicado', () => {
  assert.equal(progressPath({ audience: 'admin', userId: 'u-9', limit: null }), '/api/sessions?userId=u-9');
});

test('el identificador se codifica para la URL', () => {
  assert.equal(progressPath({ audience: 'admin', userId: 'a b&c', limit: null }), '/api/sessions?userId=a+b%26c');
});

test('sin vocero indicado la vista administrativa no consulta nada', () => {
  assert.equal(progressPath({ audience: 'admin' }), null);
  assert.equal(progressPath({ audience: 'admin', userId: null }), null);
  assert.equal(progressPath({ audience: 'admin', userId: '' }), null);
});

test('el historial se pide paginado (bloque y página)', () => {
  assert.equal(progressPath({ page: 3 }), '/api/sessions?page=3&limit=20');
  assert.equal(progressPath({ page: 1 }), '/api/sessions?limit=20');
  assert.equal(progressPath({ page: 0 }), '/api/sessions?limit=20', 'la página 1 no se envía');
  assert.equal(
    progressPath({ audience: 'admin', userId: 'u-9', page: 2, limit: 20 }),
    '/api/sessions?userId=u-9&page=2&limit=20',
  );
});

test('las estadísticas usan una ventana acotada del mismo endpoint', () => {
  assert.equal(analyticsPath({}), '/api/sessions?limit=50');
  assert.equal(analyticsPath({ audience: 'admin', userId: 'u-9' }), '/api/sessions?userId=u-9&limit=50');
});

