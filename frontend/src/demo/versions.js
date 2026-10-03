// Equivalencias entre la versión nueva (rutas de React) y la versión antigua
// (wireframe original en public/version-antigua.html, pantallas u1…m3).
// El switch flotante usa estas tablas para abrir la pantalla equivalente.

export const LEGACY_URL = '/version-antigua.html';

// Lecciones del wireframe ↔ lecciones de la versión nueva
const LESSONS = { 'mensajes-clave': 'Mensajes puente', 'preguntas-hostiles': 'Preguntas hostiles', 'lenguaje-no-verbal': 'Lenguaje no verbal' };

// Ruta nueva → pantalla antigua (la primera coincidencia gana)
const NEW_TO_OLD = [
  ['/vocero/escenarios', 'u2'],
  ['/vocero/preparar', 'u3'],
  ['/vocero/sesion', 'u4'],
  ['/vocero/analizando', 'u5'],
  ['/vocero/informe', 'u6'],
  ['/vocero/progreso', 'u7'],
  ['/vocero/leccion', 'lesson'],
  ['/vocero', 'u1'],
  ['/admin/tema', 'a2'],
  ['/admin/retencion', 'a3'],
  ['/admin', 'a1'],
  ['/maestro/rubrica', 'm2'],
  ['/maestro/etiquetado', 'm3'],
  ['/maestro/informe', 'm3'],
  ['/maestro', 'm1'],
];

const OLD_HOME = { user: 'u1', admin: 'a1', master: 'm1' };

// URL de la versión antigua equivalente a la ruta actual de la versión nueva
export function legacyUrlFor(pathname, role) {
  // La versión antigua no tenía administrador del sistema: se abre en su login
  if (!role || !OLD_HOME[role]) return LEGACY_URL;
  const match = NEW_TO_OLD.find(([prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  const screen = match ? match[1] : OLD_HOME[role];
  const params = new URLSearchParams({ role, s: screen });
  if (screen === 'lesson') params.set('leccion', LESSONS[pathname.split('/')[3]] || 'Mensajes puente');
  return `${LEGACY_URL}?${params}`;
}

// Pantalla antigua → ruta nueva
const OLD_TO_NEW = {
  u1: '/vocero',
  u2: '/vocero/escenarios',
  u3: '/vocero/preparar',
  u4: '/vocero/sesion',
  u5: '/vocero/informe', // sin una práctica en curso, "Analizando" no tiene qué mostrar
  u6: '/vocero/informe',
  u7: '/vocero/progreso',
  lesson: '/vocero/leccion',
  a1: '/admin',
  a2: '/admin/tema',
  a3: '/admin/retencion',
  m1: '/maestro',
  m2: '/maestro/rubrica',
  m3: '/maestro/etiquetado',
};

export function newPathFor(screen, lessonName) {
  if (screen === 'lesson') {
    const id = Object.entries(LESSONS).find(([, name]) => name === lessonName)?.[0];
    return id ? `/vocero/leccion/${id}` : '/vocero/leccion';
  }
  return OLD_TO_NEW[screen] || '/login';
}
