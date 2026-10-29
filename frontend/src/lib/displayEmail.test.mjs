import assert from 'node:assert/strict';
import test from 'node:test';

import { displayEmail, isAnonymizedEmail } from './displayEmail.js';

// La abreviación es SOLO visual: el valor del correo nunca se altera.
test('el correo de un usuario anonimizado se abrevia conservando parte del identificador', () => {
  assert.equal(displayEmail({ email: 'anon+18c4f2a1-9d3e@removed.local' }), 'anon+18c...@removed.local');
  assert.equal(displayEmail('anon+abcdef@removed.local'), 'anon+abc...@removed.local');
});

test('los correos normales se muestran sin cambios', () => {
  assert.equal(displayEmail({ email: 'vocero.a@empresa.com' }), 'vocero.a@empresa.com');
  assert.equal(displayEmail({ email: 'anon+algo@empresa.com' }), 'anon+algo@empresa.com');
  assert.equal(displayEmail({ email: 'admin@removed.local' }), 'admin@removed.local');
});

test('no se inventa nada si falta el correo', () => {
  assert.equal(displayEmail(null), '');
  assert.equal(displayEmail({}), '');
  assert.equal(displayEmail({ email: '' }), '');
});

test('se distingue cuándo un correo es de un usuario anonimizado', () => {
  assert.equal(isAnonymizedEmail('anon+18c4f2a1@removed.local'), true);
  assert.equal(isAnonymizedEmail('vocero@empresa.com'), false);
  assert.equal(isAnonymizedEmail(null), false);
});

test('la abreviación no depende de la longitud del identificador', () => {
  assert.equal(displayEmail({ email: 'anon+ab@removed.local' }), 'anon+ab...@removed.local');
  assert.equal(displayEmail({ email: 'anon+x@removed.local' }), 'anon+x...@removed.local');
});
