// Alcance de la consulta del historial de prácticas: qué vocero puede consultar cada rol.
//
// El identificador que envía el frontend NUNCA es la comprobación de autorización: aquí se
// resuelve en el servidor, con el rol autenticado y la organización del vocero consultado.
//   VOCERO ('user')    → siempre lo suyo; un `userId` distinto se rechaza.
//   ADMIN (cliente)    → solo voceros de SU organización (debe indicar `userId`).
//   MASTER/SYSTEM      → cualquier vocero (staff VoxReady).
//
// Es puro (la búsqueda del usuario se inyecta) para poder probarlo sin base de datos.
const VOCERO_ROLE = 'VOCERO';

// Paginación de la consulta del historial (en el servidor: nunca se trae todo el historial).
//  - `page` empieza en 1; un valor inválido cae en 1.
//  - `limit` por defecto 50 (el tope histórico del endpoint) y máximo 50.
// Devuelve `{ page, limit, skip }` listo para Prisma.
function resolvePaging({ page, limit } = {}, { defaultLimit = 50, maxLimit = 50 } = {}) {
  const parsedPage = Math.floor(Number(page));
  const parsedLimit = Math.floor(Number(limit));
  const safePage = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;
  const safeLimit = Number.isFinite(parsedLimit) && parsedLimit > 0
    ? Math.min(parsedLimit, maxLimit)
    : defaultLimit;
  return { page: safePage, limit: safeLimit, skip: (safePage - 1) * safeLimit };
}

async function resolveSessionOwner({ apiRole, requester = {}, requestedUserId = null, findUser } = {}) {
  const requested = requestedUserId ? String(requestedUserId) : null;
  // Cualquier rol ausente o desconocido se trata como VOCERO (lo más restrictivo): el
  // middleware real siempre informa `req.apiRole`, así que esto es solo una red de seguridad.
  const role = ['user', 'admin', 'master', 'system'].includes(apiRole) ? apiRole : 'user';

  // El vocero solo puede ver lo suyo, aunque envíe el identificador de otro vocero.
  if (role === 'user') {
    if (requested && requested !== requester.id) {
      return { status: 403, error: 'Solo puedes consultar tus propias prácticas.' };
    }
    return { id: requester.id, name: requester.name || null, scope: 'self' };
  }

  // El administrador del cliente consulta a un vocero concreto de su organización.
  if (!requested) {
    return { status: 400, error: 'Indica el vocero cuya práctica quieres consultar.' };
  }

  const user = await findUser(requested);
  // Solo los voceros tienen prácticas: cualquier otro usuario (o inexistente) no es consultable.
  if (!user || user.role !== VOCERO_ROLE) return { status: 404, error: 'Vocero no encontrado.' };

  if (role === 'admin' && user.tenantId !== requester.tenantId) {
    return { status: 403, error: 'Solo puedes consultar a los voceros de tu organización.' };
  }

  return { id: user.id, name: user.name || null, scope: role === 'admin' ? 'tenant' : 'global' };
}

module.exports = { resolveSessionOwner, resolvePaging, VOCERO_ROLE };
