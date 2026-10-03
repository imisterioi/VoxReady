// Solicitudes de borrado de la organización (retención / derecho al olvido).
// - El administrador del cliente crea solicitudes SOLO de su organización.
// - Al COMPLETAR una solicitud:
//     scope RECORDINGS → elimina las grabaciones (.webm) del vocero.
//     scope ANONYMIZE  → anonimiza al vocero completo (usuario + sesiones + videos).
// - Máquina de estados: PENDING → APPROVED|REJECTED; APPROVED → COMPLETED.
// - Separación de funciones: un ADMIN no resuelve su propia solicitud (lo hace SYSTEM).
const { requireAuth } = require('../auth');
const { anonymizeUser, deleteUserVideos } = require('../lib/anonymize');

const fail = (res, code, mensaje) => res.status(code).json({ status: 'error', mensaje });

const STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'COMPLETED'];
// RECORDINGS = solo grabaciones | ANONYMIZE = anonimización completa del vocero
const SCOPES = ['RECORDINGS', 'ANONYMIZE'];

// Transiciones permitidas entre estados
const TRANSITIONS = {
  PENDING: ['APPROVED', 'REJECTED'],
  APPROVED: ['COMPLETED'],
  REJECTED: [],
  COMPLETED: [],
};

const toApi = (r) => ({
  id: r.id,
  scope: r.scope,
  reason: r.reason,
  status: r.status,
  createdAt: r.createdAt,
  resolvedAt: r.resolvedAt,
  resolutionNote: r.resolutionNote,
  targetUser: r.targetUser ? { id: r.targetUser.id, name: r.targetUser.name, email: r.targetUser.email } : null,
  requestedBy: r.requestedBy ? { id: r.requestedBy.id, name: r.requestedBy.name } : null,
  resolvedBy: r.resolvedBy ? { id: r.resolvedBy.id, name: r.resolvedBy.name } : null,
});

module.exports = function registerDeletionRoutes(app, prisma) {
  const auth = (...roles) => requireAuth(prisma, roles);
  const include = { targetUser: true, requestedBy: true, resolvedBy: true };

  // Lista las solicitudes de la organización del administrador
  app.get('/api/deletion-requests', auth('admin', 'system'), async (req, res) => {
    try {
      const where = req.apiRole === 'admin' ? { tenantId: req.user.tenantId } : {};
      const requests = await prisma.deletionRequest.findMany({ where, orderBy: { createdAt: 'desc' }, include });
      res.json({ status: 'ok', requests: requests.map(toApi) });
    } catch (error) {
      console.error('Error listando solicitudes de borrado:', error);
      fail(res, 500, 'No se pudieron obtener las solicitudes.');
    }
  });

  // Crea una solicitud de borrado (solo para voceros de su propia organización)
  app.post('/api/deletion-requests', auth('admin'), async (req, res) => {
    try {
      const { targetUserId = null, scope = 'RECORDINGS', reason = '' } = req.body || {};
      if (!SCOPES.includes(scope)) return fail(res, 400, 'Tipo de solicitud no válido.');
      if (!targetUserId) return fail(res, 400, 'Selecciona el vocero cuyos datos se solicita borrar.');

      const target = await prisma.user.findUnique({ where: { id: targetUserId } });
      if (!target || target.tenantId !== req.user.tenantId || target.role !== 'VOCERO') {
        return fail(res, 403, 'Solo puedes solicitar el borrado de voceros de tu organización.');
      }

      const request = await prisma.deletionRequest.create({
        data: {
          scope,
          reason: reason?.trim() || null,
          status: 'PENDING',
          tenantId: req.user.tenantId,
          requestedById: req.user.id,
          targetUserId: target.id,
        },
        include,
      });
      res.status(201).json({ status: 'ok', request: toApi(request) });
    } catch (error) {
      console.error('Error creando solicitud de borrado:', error);
      fail(res, 500, 'No se pudo crear la solicitud.');
    }
  });

  // Cambia el estado: aprobar, rechazar o completar (al completar ejecuta la acción)
  app.patch('/api/deletion-requests/:id', auth('admin', 'system'), async (req, res) => {
    try {
      const { status, resolutionNote = '' } = req.body || {};
      if (!STATUSES.includes(status)) return fail(res, 400, 'Estado no válido.');

      const request = await prisma.deletionRequest.findUnique({ where: { id: req.params.id } });
      if (!request) return fail(res, 404, 'Solicitud no encontrada.');
      if (req.apiRole === 'admin' && request.tenantId !== req.user.tenantId) {
        return fail(res, 403, 'Solo puedes gestionar solicitudes de tu organización.');
      }

      // 1) Máquina de estados
      if (!TRANSITIONS[request.status].includes(status)) {
        return fail(res, 400, `No es posible pasar de ${request.status} a ${status}.`);
      }

      // 2) Separación de funciones: un ADMIN no resuelve su propia solicitud.
      //    SYSTEM (staff VoxReady) puede actuar; otro ADMIN del mismo tenant también.
      if (req.apiRole === 'admin' && request.requestedById === req.user.id) {
        return fail(res, 403, 'No puedes resolver tu propia solicitud; la revisa el equipo VoxReady.');
      }

      // 3) Al COMPLETAR se ejecuta la acción del alcance
      let effect = null;
      if (status === 'COMPLETED') {
        if (request.scope === 'ANONYMIZE') {
          if (!request.targetUserId) return fail(res, 400, 'La solicitud no tiene un vocero objetivo.');
          effect = await anonymizeUser(prisma, request.targetUserId);
        } else {
          const removed = await deleteUserVideos(prisma, request.tenantId, request.targetUserId ? [request.targetUserId] : []);
          effect = { videosRemoved: removed };
        }
      }

      const finalized = ['REJECTED', 'COMPLETED'].includes(status);
      // Para anonimización no se reintroduce texto libre en la solicitud
      const note = status === 'COMPLETED' && request.scope === 'ANONYMIZE' ? null : resolutionNote?.trim() || null;

      const updated = await prisma.deletionRequest.update({
        where: { id: request.id },
        data: {
          status,
          resolutionNote: note,
          resolvedAt: finalized ? new Date() : request.resolvedAt,
          resolvedById: finalized ? req.user.id : request.resolvedById,
        },
        include,
      });
      res.json({ status: 'ok', request: toApi(updated), effect });
    } catch (error) {
      console.error('Error procesando solicitud de borrado:', error);
      fail(res, 500, 'No se pudo procesar la solicitud.');
    }
  });
};
