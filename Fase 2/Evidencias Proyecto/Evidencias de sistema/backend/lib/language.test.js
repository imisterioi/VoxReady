// Pruebas del módulo de idioma: normalización, precedencia y código para el reconocimiento de voz.
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  SUPPORTED,
  DEFAULT,
  LABELS,
  normalizeLanguage,
  isEnabledLanguage,
  languages,
  resolveLanguage,
  asrLanguage,
  supportsLanguage,
  supportsAutodetect,
  enginesForLanguage,
  sessionLanguage,
  scenarioLanguageAllowed,
} = require('./language');

test('solo se admiten los idiomas soportados', () => {
  assert.deepEqual(SUPPORTED, ['es', 'en']);
  assert.equal(DEFAULT, 'es');
  assert.equal(LABELS.es, 'Español');
  assert.equal(LABELS.en, 'English');
});

test('normalizeLanguage acepta variantes de mayúsculas y locales', () => {
  assert.equal(normalizeLanguage('ES'), 'es');
  assert.equal(normalizeLanguage('en-US'), 'en');
  assert.equal(normalizeLanguage('es_CL'), 'es');
  assert.equal(normalizeLanguage('  En  '), 'en');
});

test('normalizeLanguage rechaza idiomas no soportados o vacíos', () => {
  assert.equal(normalizeLanguage('fr'), null);
  assert.equal(normalizeLanguage(''), null);
  assert.equal(normalizeLanguage(null), null);
  assert.equal(normalizeLanguage(undefined), null);
});

test('resolveLanguage: la preferencia individual manda sobre el idioma de la organización', () => {
  assert.equal(resolveLanguage({ language: 'en' }, { defaultLanguage: 'es' }), 'en');
  assert.equal(resolveLanguage({ language: 'es' }, { defaultLanguage: 'en' }), 'es');
});

test('resolveLanguage: sin preferencia individual se hereda el idioma de la organización', () => {
  assert.equal(resolveLanguage({ language: null }, { defaultLanguage: 'en' }), 'en');
  assert.equal(resolveLanguage({ language: null }, { defaultLanguage: 'es' }), 'es');
  assert.equal(resolveLanguage({ language: null, tenant: { defaultLanguage: 'en' } }, null), 'en');
});

test('resolveLanguage: sin datos válidos cae al idioma predeterminado', () => {
  assert.equal(resolveLanguage(null, null), 'es');
  assert.equal(resolveLanguage({ language: 'fr' }, { defaultLanguage: 'de' }), 'es');
  assert.equal(resolveLanguage({}, {}), 'es');
});

test('asrLanguage devuelve el código ISO o multi para autodetección', () => {
  assert.equal(asrLanguage('es'), 'es');
  assert.equal(asrLanguage('en'), 'en');
  assert.equal(asrLanguage(null), 'multi');
  assert.equal(asrLanguage('fr'), 'multi');
});

test('el registro expone los idiomas habilitados y valida los admitidos', () => {
  assert.deepEqual(SUPPORTED, ['es', 'en']);
  assert.deepEqual(languages(), [
    { code: 'es', label: 'Español' },
    { code: 'en', label: 'English' },
  ]);
  assert.equal(isEnabledLanguage('es'), true);
  assert.equal(isEnabledLanguage('pt'), false, 'un idioma no habilitado no se admite');
  assert.equal(isEnabledLanguage(''), false);
});

test('asrLanguage resuelve el código de cada motor desde el registro central', () => {
  assert.equal(asrLanguage('es', 'iso'), 'es');
  assert.equal(asrLanguage('en', 'iso'), 'en');
  assert.equal(asrLanguage('es', 'canary'), 'es-US');
  assert.equal(asrLanguage('en', 'canary'), 'en-US');
  assert.equal(asrLanguage('pt', 'iso'), 'multi', 'idioma desconocido: Whisper puede autodetectar');
  assert.equal(asrLanguage('en', 'motor-desconocido'), null, 'un motor desconocido no se da por compatible');
});

test('asrLanguage nunca devuelve el código de OTRO idioma', () => {
  // Antes Canary «caía» a es-US cuando no había idioma: eso transcribía en español sin avisar.
  assert.equal(asrLanguage('multi', 'canary'), null, 'Canary no autodetecta: no debe usarse');
  assert.equal(asrLanguage(null, 'canary'), null);
  assert.equal(asrLanguage('multi', 'iso'), 'multi', 'Whisper sí autodetecta de forma intencional');
  assert.equal(asrLanguage(null, 'iso'), 'multi');
});

test('supportsLanguage y enginesForLanguage informan de la compatibilidad real', () => {
  assert.equal(supportsLanguage('es', 'iso'), true);
  assert.equal(supportsLanguage('en', 'canary'), true);
  assert.equal(supportsLanguage('pt', 'canary'), false, 'un idioma no habilitado no es compatible');
  assert.equal(supportsLanguage('multi', 'canary'), false);
  assert.equal(supportsAutodetect('iso'), true);
  assert.equal(supportsAutodetect('canary'), false);
  assert.deepEqual(enginesForLanguage('es'), ['iso', 'canary']);
  assert.deepEqual(enginesForLanguage('en'), ['iso', 'canary']);
  assert.deepEqual(enginesForLanguage('multi'), ['iso'], 'sin idioma solo los que autodetectan');
});


test('sessionLanguage: el idioma congelado en la sesión manda sobre la preferencia actual', () => {
  assert.equal(sessionLanguage({ language: 'en' }, { language: 'es' }, { defaultLanguage: 'es' }), 'en');
  assert.equal(sessionLanguage({ language: 'es' }, { language: 'en' }, { defaultLanguage: 'en' }), 'es');
});

test('sessionLanguage: en sesiones históricas (sin idioma) se usa el del vocero o su organización', () => {
  assert.equal(sessionLanguage({ language: null }, { language: 'en' }, { defaultLanguage: 'es' }), 'en');
  assert.equal(sessionLanguage({}, { language: null }, { defaultLanguage: 'en' }), 'en');
  assert.equal(sessionLanguage(null, null, null), 'es');
  assert.equal(sessionLanguage({ language: 'fr' }, { language: 'fr' }, { defaultLanguage: 'de' }), 'es');
});

// Regla del rechazo HTTP 403 al iniciar una práctica (POST /api/sessions).
test('scenarioLanguageAllowed: solo se puede practicar con un escenario del idioma activo', () => {
  assert.equal(scenarioLanguageAllowed('es', 'es'), true);
  assert.equal(scenarioLanguageAllowed('en', 'en'), true);
  assert.equal(scenarioLanguageAllowed('ES', 'es'), true, 'la forma del código no cambia el idioma');
  assert.equal(scenarioLanguageAllowed('en-US', 'en'), true, 'un locale del mismo idioma es válido');

  assert.equal(scenarioLanguageAllowed('en', 'es'), false, 'escenario en inglés con sesión en español');
  assert.equal(scenarioLanguageAllowed('es', 'en'), false, 'escenario en español con sesión en inglés');
});

test('scenarioLanguageAllowed: un escenario sin idioma válido nunca se acepta (no se sustituye)', () => {
  for (const value of [null, undefined, '', '   ', 'fr', 'pt', 'xx']) {
    assert.equal(scenarioLanguageAllowed(value, 'es'), false, `«${String(value)}» no puede pasar como español`);
    assert.equal(scenarioLanguageAllowed(value, 'en'), false, `«${String(value)}» no puede pasar como inglés`);
  }
  assert.equal(scenarioLanguageAllowed('es', null), false, 'sin idioma de sesión tampoco se acepta');
});
