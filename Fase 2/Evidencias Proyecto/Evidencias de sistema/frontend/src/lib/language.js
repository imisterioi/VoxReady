// Registro central de idiomas de la plataforma (frontend).
//
// PARA AÑADIR UN IDIOMA NUEVO:
//   1. Agregar aquí su entrada con `enabled: true` (y su etiqueta visible).
//   2. Crear `data/dictionary.<code>.js` y registrarlo en `data/dictionary.js`.
//   3. (Backend) habilitarlo en `backend/lib/language.js` y añadir su catálogo de escenarios.
// Los selectores, el proveedor de idioma y el filtrado de escenarios usan este registro: no hay
// condiciones por idioma repartidas por los componentes.
export const LANGUAGES = [
  { code: 'es', label: 'Español', enabled: true },
  { code: 'en', label: 'English', enabled: true },
  // Idiomas preparados pero todavía NO habilitados (poner `enabled: true` para activarlos):
  // { code: 'pt', label: 'Português', enabled: false },
  // { code: 'fr', label: 'Français', enabled: false },
];

const ENABLED = LANGUAGES.filter((entry) => entry.enabled);

// Códigos habilitados (los únicos que se pueden seleccionar).
export const LANGUAGE_CODES = ENABLED.map((entry) => entry.code);

// Idioma predeterminado general de la plataforma.
export const DEFAULT_LANGUAGE = (ENABLED[0] || { code: 'es' }).code;

// Etiqueta visible de cada idioma habilitado.
export const LANGUAGE_LABELS = Object.fromEntries(ENABLED.map((entry) => [entry.code, entry.label]));

// Normaliza un valor libre ('ES', 'es-CL', 'en-US', '') al idioma habilitado, o null si no lo es.
export function normalizeLanguage(value) {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return null;
  const base = raw.split(/[-_]/)[0];
  return LANGUAGE_CODES.includes(base) ? base : null;
}

// ¿El idioma está habilitado?
export function isEnabledLanguage(value) {
  return normalizeLanguage(value) !== null;
}

// Idioma efectivo: preferencia individual > selección explícita guardada localmente (login) >
// idioma inicial del tenant > idioma predeterminado de la plataforma.
export function resolveLanguage(user, stored = null) {
  return (
    normalizeLanguage(user?.language) ||
    normalizeLanguage(stored) ||
    normalizeLanguage(user?.defaultLanguage) ||
    DEFAULT_LANGUAGE
  );
}

// Código canónico del idioma (nunca null): lo no reconocido cae al predeterminado.
export function effectiveCode(value) {
  return normalizeLanguage(value) || DEFAULT_LANGUAGE;
}

// ¿Cambió el idioma efectivo respecto del último ya aplicado?
//
// Se usa para invalidar los datos que DEPENDEN del idioma (el catálogo de escenarios que filtra el
// backend) sin provocar peticiones innecesarias: si el idioma se re-aplica con el mismo valor, no
// hay nada que volver a pedir. Es lógica pura para poder probarla sin navegador.
export function languageChanged(applied, next) {
  return effectiveCode(applied) !== effectiveCode(next);
}

