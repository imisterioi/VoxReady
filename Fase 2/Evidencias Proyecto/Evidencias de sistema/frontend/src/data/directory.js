// Utilidades compartidas para organizaciones y usuarios.
// Los datos vienen del backend (/api/tenants, /api/users, /api/system/overview).

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

export const initialsOf = (name = '') =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() || '')
    .join('');

export const formatDate = (iso) =>
  iso ? new Date(iso).toLocaleDateString('es-CL', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

export function timeAgo(iso) {
  if (!iso) return 'Nunca';
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'Hace un momento';
  if (diff < 3600) return `Hace ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `Hace ${Math.floor(diff / 3600)} h`;
  const days = Math.floor(diff / 86400);
  if (days === 1) return 'Ayer';
  if (days < 30) return `Hace ${days} días`;
  return formatDate(iso);
}
