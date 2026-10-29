// Formulario dinámico de solicitudes del administrador del cliente.
//
// Tipos REALES que admite el backend (no se inventa ninguno):
//   RECORDINGS          → POST /api/deletion-requests   { targetUserId, scope:'RECORDINGS', reason }
//   ANONYMIZE           → POST /api/deletion-requests   { targetUserId, scope:'ANONYMIZE',  reason }
//   RETENTION_EXTENSION → POST /api/retention-requests  { requestedDays, reason }
//
// El módulo es puro: decide qué campos corresponden a cada tipo, valida y construye el cuerpo que
// se envía. Así se garantiza que al cambiar de tipo NO se envíen campos del tipo anterior.
export const MAX_DAYS = 3650; // mismo límite que la configuración de retención del backend

export const REQUEST_TYPES = [
  {
    value: 'RECORDINGS',
    label: 'Eliminar grabaciones',
    kind: 'privacy',
    endpoint: '/api/deletion-requests',
    description: 'Se eliminarán las grabaciones del vocero seleccionado.',
    fields: ['targetUserId', 'reason'],
  },
  {
    value: 'ANONYMIZE',
    label: 'Anonimizar vocero',
    kind: 'privacy',
    endpoint: '/api/deletion-requests',
    description: 'Se anonimizará al vocero: se eliminan sus datos personales, el contenido de sus sesiones y sus grabaciones.',
    fields: ['targetUserId', 'reason'],
  },
  {
    value: 'RETENTION_EXTENSION',
    label: 'Extensión del plazo de conservación',
    kind: 'retention',
    endpoint: '/api/retention-requests',
    description: 'Pide conservar durante más tiempo los datos que ya existen. La solicitud la revisa el equipo VoxReady.',
    fields: ['requestedDays', 'reason'],
  },
];

export const DEFAULT_REQUEST_TYPE = 'RECORDINGS';

export const requestType = (value) => REQUEST_TYPES.find((type) => type.value === value) || null;

// Formulario vacío del tipo indicado: solo los campos que ese tipo necesita.
export function emptyRequestForm(type = DEFAULT_REQUEST_TYPE) {
  return { type, targetUserId: '', requestedDays: '', reason: '' };
}

// Cambiar de tipo SIEMPRE parte de un formulario limpio del nuevo tipo: los datos del tipo
// anterior (vocero o plazo) no se arrastran ni pueden enviarse por error.
export function switchRequestType(type) {
  return emptyRequestForm(requestType(type) ? type : DEFAULT_REQUEST_TYPE);
}

// Validación de lo que se va a enviar (las mismas reglas que aplica el backend).
export function validateRequestForm(form = {}, { currentDays = 0 } = {}) {
  const type = requestType(form.type);
  if (!type) return { ok: false, error: 'Selecciona el tipo de solicitud.' };

  if (type.kind === 'privacy') {
    if (!form.targetUserId) return { ok: false, error: 'Selecciona un vocero.' };
    return { ok: true, error: '' };
  }

  const requested = Math.round(Number(form.requestedDays));
  if (!Number.isFinite(requested) || requested < 1 || requested > MAX_DAYS) {
    return { ok: false, error: `Indica un plazo entre 1 y ${MAX_DAYS} días.` };
  }
  if (requested <= Number(currentDays || 0)) {
    return { ok: false, error: `La extensión debe ser mayor que el plazo vigente (${currentDays} días).` };
  }
  return { ok: true, error: '' };
}

// Cuerpo de la petición: SOLO los campos del tipo seleccionado (nunca los del tipo anterior).
export function buildRequestPayload(form = {}, { currentDays = 0 } = {}) {
  const type = requestType(form.type);
  if (!type) return null;
  const validation = validateRequestForm(form, { currentDays });
  if (!validation.ok) return null;

  const reason = typeof form.reason === 'string' ? form.reason.trim() : '';
  if (type.kind === 'privacy') {
    return { endpoint: type.endpoint, body: { targetUserId: form.targetUserId, scope: type.value, reason } };
  }
  return { endpoint: type.endpoint, body: { requestedDays: Math.round(Number(form.requestedDays)), reason } };
}

// Plazo sugerido al elegir una extensión (el doble del vigente, sin pasar del máximo).
export function suggestedExtensionDays(currentDays = 0) {
  const suggested = Math.max(1, Number(currentDays || 0)) * 2;
  return Math.min(suggested, MAX_DAYS);
}
