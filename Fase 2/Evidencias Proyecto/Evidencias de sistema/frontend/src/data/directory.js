// Utilidades compartidas para organizaciones y usuarios.
// Los datos vienen del backend (/api/tenants, /api/users, /api/system/overview).
//
// Los textos visibles (roles, estados, sectores, áreas y fechas relativas) son contenido FIJO del
// sistema: se resuelven desde el diccionario del idioma activo (`d.L.dir`). Las funciones reciben el
// diccionario (`d`) o el idioma (`lang`) para no depender de estado global.
//
// Se conservan los mapas en español como RESPALDO: las pantallas todavía no migradas siguen
// funcionando y el comportamiento por defecto continúa siendo el español (nunca se traduce
// contenido creado por usuarios: solo etiquetas del sistema).

export const ROLE_META = {
  system: { label: 'Administrador del sistema', short: 'Sistema', tone: 'brand' },
  master: { label: 'Configurador maestro', short: 'Configurador', tone: 'success' },
  admin: { label: 'Administrador del cliente', short: 'Admin. cliente', tone: 'accent' },
  user: { label: 'Vocero', short: 'Vocero', tone: 'outline' },
};

export const STATUS_META = {
  ACTIVE: { label: 'Activo', tone: 'success' },
  SUSPENDED: { label: 'Suspendido', tone: 'danger' },
};

export const SECTORS = ['Retail', 'Energía', 'Salud', 'Logística', 'Banca', 'Minería', 'Sector público', 'Otro'];
export const AREAS = ['Dirección', 'Planta', 'Técnicos'];

// Versiones dependientes del idioma (usan el diccionario activo; si falta, caen al respaldo).
export const roleMeta = (d) => d?.L?.dir?.roles || ROLE_META;
export const statusMeta = (d) => d?.L?.dir?.statuses || STATUS_META;
export const sectors = (d) => d?.L?.dir?.sectors || SECTORS;
export const areas = (d) => d?.L?.dir?.areas || AREAS;

export const initialsOf = (name = '') =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() || '')
    .join('');

// Locale solo para formatear fechas: el idioma activo decide el formato.
const LOCALES = { es: 'es-CL', en: 'en-US' };

// Locale del idioma activo (para fechas cortas u horas fuera de `formatDate`).
export const localeFor = (lang = 'es') => LOCALES[lang] || LOCALES.es;

export const formatDate = (iso, lang = 'es') =>
  iso ? new Date(iso).toLocaleDateString(LOCALES[lang] || LOCALES.es, { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

export function timeAgo(iso, d = null) {
  const t = d?.L?.dir;
  if (!iso) return t?.never || 'Nunca';
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return t?.justNow || 'Hace un momento';
  if (diff < 3600) return t ? t.minutesAgo(Math.floor(diff / 60)) : `Hace ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return t ? t.hoursAgo(Math.floor(diff / 3600)) : `Hace ${Math.floor(diff / 3600)} h`;
  const days = Math.floor(diff / 86400);
  if (days === 1) return t?.yesterday || 'Ayer';
  if (days < 30) return t ? t.daysAgo(days) : `Hace ${days} días`;
  return formatDate(iso);
}
