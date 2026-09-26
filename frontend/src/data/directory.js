import { useSyncExternalStore } from 'react';

// ---------------------------------------------------------------------------
// Directorio de organizaciones y usuarios (datos de demostración).
//
// Se guarda en localStorage para que la demo funcione sin backend. Cada función
// exportada equivale a un endpoint futuro, por lo que se puede reemplazar por
// llamadas a la API sin tocar las pantallas:
//   createTenant   → POST  /api/tenants
//   createUser     → POST  /api/users
//   setUserStatus  → PATCH /api/users/:id
//   setTenantStatus→ PATCH /api/tenants/:id
// ---------------------------------------------------------------------------

const KEY = 'voxready_directory_v1';

export const ROLE_META = {
  system: { label: 'Administrador del sistema', short: 'Sistema', tone: 'brand' },
  master: { label: 'Configurador maestro', short: 'Configurador', tone: 'success' },
  admin: { label: 'Administrador del cliente', short: 'Admin. cliente', tone: 'accent' },
  user: { label: 'Vocero', short: 'Vocero', tone: 'outline' },
};

export const STATUS_META = {
  ACTIVE: { label: 'Activo', tone: 'success' },
  INVITED: { label: 'Invitación pendiente', tone: 'warning' },
  SUSPENDED: { label: 'Suspendido', tone: 'danger' },
};

export const SECTORS = ['Retail', 'Energía', 'Salud', 'Logística', 'Banca', 'Minería', 'Sector público', 'Otro'];
export const AREAS = ['Dirección', 'Planta', 'Técnicos'];

const daysAgo = (n, h = 10) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(h, 0, 0, 0);
  return d.toISOString();
};

const SEED = {
  tenants: [
    { id: 't-visum', name: 'Visum', sector: 'Retail', status: 'ACTIVE', createdAt: daysAgo(116), sessionsMonth: 152 },
    { id: 't-andes', name: 'Energía Andes', sector: 'Energía', status: 'ACTIVE', createdAt: daysAgo(74), sessionsMonth: 88 },
    { id: 't-norte', name: 'Clínica Norte', sector: 'Salud', status: 'ACTIVE', createdAt: daysAgo(36), sessionsMonth: 41 },
    { id: 't-austral', name: 'Puerto Austral', sector: 'Logística', status: 'SUSPENDED', createdAt: daysAgo(140), sessionsMonth: 0 },
  ],
  users: [
    // Staff de VoxReady
    { id: 'u-sofia', name: 'Sofía Reyes', email: 'sofia@voxready.io', role: 'system', tenantId: null, status: 'ACTIVE', createdAt: daysAgo(180), lastActive: daysAgo(0, 9) },
    { id: 'u-marta', name: 'Marta Vidal', email: 'marta@voxready.io', role: 'master', tenantId: null, status: 'ACTIVE', createdAt: daysAgo(170), lastActive: daysAgo(1) },
    { id: 'u-ignacio', name: 'Ignacio Vera', email: 'ignacio@voxready.io', role: 'master', tenantId: null, status: 'ACTIVE', createdAt: daysAgo(60), lastActive: daysAgo(3) },
    // Visum
    { id: 'u-carlos', name: 'Carlos Ruiz', email: 'carlos@visum.com', role: 'admin', tenantId: 't-visum', status: 'ACTIVE', createdAt: daysAgo(115), lastActive: daysAgo(0, 8) },
    { id: 'u-ana', name: 'Ana Torres', email: 'ana@visum.com', role: 'user', tenantId: 't-visum', area: 'Dirección', status: 'ACTIVE', createdAt: daysAgo(110), lastActive: daysAgo(0, 11), sessions: 12 },
    { id: 'u-diego', name: 'Diego Paredes', email: 'diego@visum.com', role: 'user', tenantId: 't-visum', area: 'Planta', status: 'ACTIVE', createdAt: daysAgo(90), lastActive: daysAgo(2), sessions: 7 },
    { id: 'u-fernanda', name: 'Fernanda Rojas', email: 'fernanda@visum.com', role: 'user', tenantId: 't-visum', area: 'Técnicos', status: 'INVITED', createdAt: daysAgo(2), lastActive: null, sessions: 0 },
    // Energía Andes
    { id: 'u-lucia', name: 'Lucía Soto', email: 'lucia@andes.cl', role: 'admin', tenantId: 't-andes', status: 'ACTIVE', createdAt: daysAgo(73), lastActive: daysAgo(1) },
    { id: 'u-tomas', name: 'Tomás Rivas', email: 'tomas@andes.cl', role: 'user', tenantId: 't-andes', area: 'Dirección', status: 'ACTIVE', createdAt: daysAgo(70), lastActive: daysAgo(1), sessions: 9 },
    { id: 'u-valentina', name: 'Valentina Muñoz', email: 'valentina@andes.cl', role: 'user', tenantId: 't-andes', area: 'Planta', status: 'ACTIVE', createdAt: daysAgo(65), lastActive: daysAgo(4), sessions: 5 },
    // Clínica Norte
    { id: 'u-camila', name: 'Camila Fuentes', email: 'camila@clinicanorte.cl', role: 'admin', tenantId: 't-norte', status: 'ACTIVE', createdAt: daysAgo(35), lastActive: daysAgo(2) },
    { id: 'u-pedro', name: 'Pedro Lagos', email: 'pedro@clinicanorte.cl', role: 'user', tenantId: 't-norte', area: 'Dirección', status: 'ACTIVE', createdAt: daysAgo(30), lastActive: daysAgo(6), sessions: 3 },
    // Puerto Austral (suspendida)
    { id: 'u-rodrigo', name: 'Rodrigo Pinto', email: 'rodrigo@puertoaustral.cl', role: 'admin', tenantId: 't-austral', status: 'SUSPENDED', createdAt: daysAgo(139), lastActive: daysAgo(45) },
  ],
  activity: [
    { id: 'a1', icon: 'users', text: 'Fernanda Rojas fue invitada como vocero en Visum', at: daysAgo(2, 16) },
    { id: 'a2', icon: 'sliders', text: 'Marta Vidal publicó una nueva versión del patrón maestro', at: daysAgo(3, 12) },
    { id: 'a3', icon: 'layers', text: 'Se creó la organización Clínica Norte', at: daysAgo(36, 9) },
    { id: 'a4', icon: 'lock', text: 'Se suspendió la organización Puerto Austral', at: daysAgo(40, 15) },
  ],
};

// ------------------------------------------------------------------ Estado

const load = () => {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* almacenamiento no disponible */
  }
  return SEED;
};

let state = load();
const listeners = new Set();

const commit = (next) => {
  state = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* almacenamiento no disponible */
  }
  listeners.forEach((l) => l());
};

const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function useDirectory() {
  return useSyncExternalStore(subscribe, () => state);
}

export const getDirectory = () => state;

// ---------------------------------------------------------------- Helpers

const uid = (p) => `${p}-${Math.random().toString(36).slice(2, 9)}`;
const nowIso = () => new Date().toISOString();

export const initialsOf = (name = '') =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() || '')
    .join('');

export const findUserByEmail = (email) =>
  state.users.find((u) => u.email.toLowerCase() === email.trim().toLowerCase());

const logActivity = (icon, text) => ({ id: uid('a'), icon, text, at: nowIso() });

const validateNewUser = ({ name, email }) => {
  if (!name?.trim()) throw new Error('Ingresa el nombre completo.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email?.trim() || '')) throw new Error('Ingresa un correo válido.');
  if (findUserByEmail(email)) throw new Error('Ya existe un usuario con ese correo.');
};

// -------------------------------------------------------------- Acciones

// Crea una organización junto con su primer administrador (invitado).
export function createTenant({ name, sector, adminName, adminEmail }) {
  if (!name?.trim()) throw new Error('Ingresa el nombre de la organización.');
  if (state.tenants.some((t) => t.name.toLowerCase() === name.trim().toLowerCase())) {
    throw new Error('Ya existe una organización con ese nombre.');
  }
  validateNewUser({ name: adminName, email: adminEmail });

  const tenant = { id: uid('t'), name: name.trim(), sector, status: 'ACTIVE', createdAt: nowIso(), sessionsMonth: 0 };
  const admin = {
    id: uid('u'),
    name: adminName.trim(),
    email: adminEmail.trim().toLowerCase(),
    role: 'admin',
    tenantId: tenant.id,
    status: 'INVITED',
    createdAt: nowIso(),
    lastActive: null,
  };

  commit({
    ...state,
    tenants: [tenant, ...state.tenants],
    users: [admin, ...state.users],
    activity: [
      logActivity('users', `${admin.name} fue invitado como administrador de ${tenant.name}`),
      logActivity('layers', `Se creó la organización ${tenant.name}`),
      ...state.activity,
    ],
  });
  return { tenant, admin };
}

// Crea un usuario (queda con invitación pendiente hasta su primer ingreso).
export function createUser({ name, email, role, tenantId = null, area }) {
  validateNewUser({ name, email });
  const needsTenant = role === 'admin' || role === 'user';
  if (needsTenant && !tenantId) throw new Error('Selecciona una organización.');

  const user = {
    id: uid('u'),
    name: name.trim(),
    email: email.trim().toLowerCase(),
    role,
    tenantId: needsTenant ? tenantId : null,
    status: 'INVITED',
    createdAt: nowIso(),
    lastActive: null,
    ...(role === 'user' ? { area, sessions: 0 } : {}),
  };

  const tenant = state.tenants.find((t) => t.id === user.tenantId);
  const where = tenant ? ` en ${tenant.name}` : '';

  commit({
    ...state,
    users: [user, ...state.users],
    activity: [logActivity('users', `${user.name} fue invitado como ${ROLE_META[role].label.toLowerCase()}${where}`), ...state.activity],
  });
  return user;
}

export function setUserStatus(id, status) {
  const user = state.users.find((u) => u.id === id);
  if (!user) return;
  commit({
    ...state,
    users: state.users.map((u) => (u.id === id ? { ...u, status } : u)),
    activity: [
      logActivity(status === 'SUSPENDED' ? 'lock' : 'check', `${user.name} fue ${status === 'SUSPENDED' ? 'suspendido' : 'reactivado'}`),
      ...state.activity,
    ],
  });
}

export function setTenantStatus(id, status) {
  const tenant = state.tenants.find((t) => t.id === id);
  if (!tenant) return;
  commit({
    ...state,
    tenants: state.tenants.map((t) => (t.id === id ? { ...t, status } : t)),
    activity: [
      logActivity(status === 'SUSPENDED' ? 'lock' : 'check', `Se ${status === 'SUSPENDED' ? 'suspendió' : 'reactivó'} la organización ${tenant.name}`),
      ...state.activity,
    ],
  });
}

// Primer ingreso: la invitación pasa a cuenta activa.
export function registerLogin(email) {
  const user = findUserByEmail(email);
  if (!user) return;
  commit({
    ...state,
    users: state.users.map((u) =>
      u.id === user.id ? { ...u, status: u.status === 'INVITED' ? 'ACTIVE' : u.status, lastActive: nowIso() } : u,
    ),
  });
}

export function resetDirectory() {
  commit(SEED);
}

// ------------------------------------------------------------- Formato

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
