// Registro central de idiomas de la plataforma y resolución del idioma efectivo de un usuario.
//
// PARA AÑADIR UN IDIOMA NUEVO solo hay que tocar este archivo (y añadir su contenido):
//   1. Agregar una entrada en `REGISTRY` con `code`, `label`, `enabled: true` y sus códigos ASR.
//   2. Añadir su diccionario en el frontend (`frontend/src/data/dictionary.<code>.js`) y su
//      entrada en `frontend/src/lib/language.js`.
//   3. Añadir su catálogo de escenarios generales (`prisma/library-scenarios.<code>.js`) y
//      registrarlo en `prisma/seed.js`.
// No hay condiciones por idioma repartidas por el código: todo se resuelve desde este registro.
//
// `asr` centraliza la equivalencia de códigos de cada motor de transcripción (cada proveedor usa
// su propio formato para el mismo idioma).
const REGISTRY = [
  {
    code: 'es',
    label: 'Español',
    englishLabel: 'Spanish',
    enabled: true,
    default: true,
    asr: { iso: 'es', canary: 'es-US' },
  },
  {
    code: 'en',
    label: 'English',
    englishLabel: 'English',
    enabled: true,
    default: false,
    asr: { iso: 'en', canary: 'en-US' },
  },
  // Idiomas preparados pero todavía NO habilitados (basta poner `enabled: true` para activarlos):
  // { code: 'pt', label: 'Português', englishLabel: 'Portuguese', enabled: false, default: false,
  //   asr: { iso: 'pt', canary: 'pt-BR' } },
  // { code: 'fr', label: 'Français', englishLabel: 'French', enabled: false, default: false,
  //   asr: { iso: 'fr', canary: 'fr-FR' } },
];

const ENABLED = REGISTRY.filter((entry) => entry.enabled);

// Motores de transcripción conocidos. `key` es la clave que cada idioma declara en `asr`:
// la PRESENCIA de esa clave es lo que significa «este motor admite este idioma».
// `autodetect` es el valor que se envía cuando NO se conoce el idioma (null = el motor no puede
// trabajar sin un idioma conocido, así que no se usa en ese caso).
const ASR_ENGINES = [
  { key: 'iso', label: 'Whisper (Large v3 y local)', autodetect: 'multi' },
  { key: 'canary', label: 'Canary 1B', autodetect: null },
];

const engineDefinition = (engine) => ASR_ENGINES.find((item) => item.key === engine) || null;

// Códigos admitidos (solo los habilitados).
const SUPPORTED = ENABLED.map((entry) => entry.code);

// Idioma predeterminado general de la plataforma.
const DEFAULT = (ENABLED.find((entry) => entry.default) || ENABLED[0] || { code: 'es' }).code;

// Etiqueta visible de cada idioma habilitado.
const LABELS = Object.fromEntries(ENABLED.map((entry) => [entry.code, entry.label]));

const entryFor = (code) => ENABLED.find((item) => item.code === code) || null;

// Normaliza un valor libre ('ES', 'es-CL', 'en-US', '') al idioma habilitado, o null si no lo es.
function normalizeLanguage(value) {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return null;
  const base = raw.split(/[-_]/)[0];
  return entryFor(base) ? base : null;
}

// ¿El idioma está habilitado en la plataforma?
function isEnabledLanguage(value) {
  return normalizeLanguage(value) !== null;
}

// Lista de idiomas habilitados (para los selectores y la API pública).
function languages() {
  return ENABLED.map((entry) => ({ code: entry.code, label: entry.label }));
}

// Idioma efectivo de un usuario: su preferencia, o la de su organización, o el predeterminado.
function resolveLanguage(user, tenant = null) {
  const own = normalizeLanguage(user?.language);
  if (own) return own;
  const org = normalizeLanguage(tenant?.defaultLanguage ?? user?.tenant?.defaultLanguage);
  return org || DEFAULT;
}

// Código que se envía a un motor de transcripción para un idioma concreto.
// Reglas (nunca se sustituye un idioma por otro):
//   - idioma conocido y admitido por el motor → su código para ese motor ('es', 'en-US'…);
//   - idioma desconocido y motor con autodetección declarada → el valor de autodetección ('multi');
//   - en cualquier otro caso → null, que significa «este motor NO sirve para este idioma».
// Devolver null (y no el código de otro idioma) es lo que impide transcribir en un idioma
// equivocado sin que nadie se entere.
function asrLanguage(language, engine = 'iso') {
  const entry = entryFor(normalizeLanguage(language));
  if (entry) return entry.asr?.[engine] ?? null;
  return engineDefinition(engine)?.autodetect ?? null;
}

// ¿El motor admite el idioma indicado? (idioma conocido y con código declarado para ese motor)
function supportsLanguage(language, engine) {
  const entry = entryFor(normalizeLanguage(language));
  return Boolean(entry?.asr?.[engine]);
}

// ¿El motor puede trabajar sin un idioma conocido (autodetección intencional)?
function supportsAutodetect(engine) {
  return Boolean(engineDefinition(engine)?.autodetect);
}

// Motores que pueden usarse para un idioma, en el orden declarado en `ASR_ENGINES`.
// Con un idioma desconocido solo se ofrecen los que admiten autodetección.
function enginesForLanguage(language) {
  const entry = entryFor(normalizeLanguage(language));
  return ASR_ENGINES.filter((engine) => (entry ? Boolean(entry.asr?.[engine.key]) : Boolean(engine.autodetect))).map(
    (engine) => engine.key,
  );
}

// Idioma de una sesión de práctica: el que se congeló al iniciarla. Si la sesión es histórica
// (sin idioma guardado), se usa el del vocero o el de su organización, sin modificar el registro.
function sessionLanguage(session, user, tenant = null) {
  return normalizeLanguage(session?.language) || resolveLanguage(user, tenant);
}

// ¿Se puede practicar con este escenario en el idioma indicado?
//
// El catálogo está separado por idioma: un escenario de otro idioma (o sin idioma válido) NO se
// puede usar, y NUNCA se sustituye por otro idioma en silencio. Es la regla que aplica el rechazo
// HTTP 403 al iniciar una práctica; se expone como función pura para poder probarla sin base de datos.
function scenarioLanguageAllowed(themeLanguage, sessionLanguage) {
  const theme = normalizeLanguage(themeLanguage);
  const session = normalizeLanguage(sessionLanguage);
  return Boolean(theme) && theme === session;
}

module.exports = {
  REGISTRY,
  ASR_ENGINES,
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
};

