// Pruebas de la lógica pura del sistema de idiomas.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LANGUAGES,
  LANGUAGE_CODES,
  LANGUAGE_LABELS,
  DEFAULT_LANGUAGE,
  normalizeLanguage,
  isEnabledLanguage,
  resolveLanguage,
  effectiveCode,
  languageChanged,
} from './language.js';

test('el registro declara los idiomas habilitados y sus etiquetas', () => {
  assert.deepEqual(LANGUAGE_CODES, ['es', 'en']);
  assert.equal(DEFAULT_LANGUAGE, 'es');
  assert.equal(LANGUAGE_LABELS.es, 'Español');
  assert.equal(LANGUAGE_LABELS.en, 'English');
  assert.ok(LANGUAGES.every((entry) => entry.code && entry.label && typeof entry.enabled === 'boolean'));
});

test('normalizeLanguage acepta variantes de mayúsculas y locales', () => {
  assert.equal(normalizeLanguage('ES'), 'es');
  assert.equal(normalizeLanguage('en-US'), 'en');
  assert.equal(normalizeLanguage('es_CL'), 'es');
  assert.equal(normalizeLanguage('  En  '), 'en');
});

test('normalizeLanguage rechaza idiomas no habilitados o vacíos', () => {
  assert.equal(normalizeLanguage('fr'), null, 'un idioma no habilitado no se puede seleccionar');
  assert.equal(normalizeLanguage('pt'), null);
  assert.equal(normalizeLanguage(''), null);
  assert.equal(normalizeLanguage(null), null);
  assert.equal(normalizeLanguage(undefined), null);
  assert.equal(isEnabledLanguage('en'), true);
  assert.equal(isEnabledLanguage('fr'), false);
});

test('la preferencia individual manda sobre la selección local y el idioma del tenant', () => {
  assert.equal(resolveLanguage({ language: 'en', defaultLanguage: 'es' }, 'es'), 'en');
  assert.equal(resolveLanguage({ language: 'es', defaultLanguage: 'en' }, 'en'), 'es');
});

test('una selección explícita (login) prevalece sobre el idioma inicial del tenant', () => {
  assert.equal(resolveLanguage({ language: null, defaultLanguage: 'en' }, 'es'), 'es');
  assert.equal(resolveLanguage({ language: null, defaultLanguage: 'es' }, 'en'), 'en');
});

test('sin preferencia ni selección se usa el idioma del tenant y, si no, el predeterminado', () => {
  assert.equal(resolveLanguage({ language: null, defaultLanguage: 'en' }, null), 'en');
  assert.equal(resolveLanguage(null, null), 'es');
  assert.equal(resolveLanguage({ language: 'fr', defaultLanguage: 'de' }, 'pt'), 'es');
});

test('effectiveCode nunca devuelve null: lo desconocido cae al idioma predeterminado', () => {
  assert.equal(effectiveCode('EN'), 'en');
  assert.equal(effectiveCode('en-US'), 'en');
  assert.equal(effectiveCode(null), DEFAULT_LANGUAGE);
  assert.equal(effectiveCode('fr'), DEFAULT_LANGUAGE, 'un idioma no habilitado no se acepta');
});

test('languageChanged solo marca cambio cuando el idioma efectivo es distinto', () => {
  assert.equal(languageChanged('es', 'en'), true);
  assert.equal(languageChanged('en', 'es'), true);
  assert.equal(languageChanged('es', 'es'), false, 're-aplicar el mismo idioma no invalida datos');
  assert.equal(languageChanged('es', 'ES'), false, 'la forma (mayúsculas) no cuenta como cambio');
  assert.equal(languageChanged('es', 'es-CL'), false, 'el locale del mismo idioma no cuenta como cambio');
  assert.equal(languageChanged(null, 'es'), false, 'sin idioma aplicado, el predeterminado ya es español');
  assert.equal(languageChanged(null, 'en'), true);
  assert.equal(languageChanged('es', 'fr'), false, 'un idioma no habilitado cae al predeterminado');
});

test('cambiar varias veces entre idiomas genera exactamente una invalidación por cambio real', () => {
  // Reproduce el caso «cambiar varias veces entre ambos idiomas»: la versión del idioma aplicado
  // (que dispara volver a pedir el catálogo) solo sube cuando el idioma cambia de verdad.
  let applied = 'es';
  let version = 0;
  for (const next of ['en', 'en', 'es', 'es', 'en']) {
    if (languageChanged(applied, next)) {
      applied = effectiveCode(next);
      version += 1;
    }
  }
  assert.equal(version, 3, 'es→en, en→es y es→en: tres invalidaciones, ninguna repetida');
  assert.equal(applied, 'en');
});

