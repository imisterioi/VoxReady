// Solicitudes de EXTENSIÓN del plazo de conservación (operación distinta a las de privacidad).
//
// - El administrador del CLIENTE crea solicitudes de su organización y consulta su estado.
// - Únicamente el ADMINISTRADOR DEL SISTEMA (SYSTEM) puede aprobarlas o rechazarlas: el
//   aislamiento se comprueba aquí, no en la interfaz.
// - Aprobar aplica el plazo de INMEDIATO (retentionDays = plazo solicitado) para que el proceso
//   automático de retención no borre los datos que la extensión protege. Rechazar no toca nada.
// - La resolución es idempotente: un segundo intento recibe 409 y no vuelve a aplicar nada.
const { requireAuth } = require('../auth');
const { applyExtension } = require('../lib/retentionSchedule');

const fail = (res, code, mensaje) => res.status(code).json({ status: 'error', mensaje });

const MIN_DAYS = 1;
const MAX_DAYS = 3650; // mismo límite que la configuración de retención

const toApi = (r) => ({
  id: r.id,
  status: r.status,
  reason: r.reason,
  currentDays: r.currentDays,
  requestedDays: r.requestedDays,
  appliedDays: r.appliedDays,
  createdAt: r.createdAt,
  resolvedAt: r.resolvedAt,
  resolutionNote: r.resolutionNote,
  tenant: r.tenant ? { id: r.tenant.id, name: r.tenant.name } : null,
  requestedBy: r.requestedBy ? { id: r.requestedBy.id, name: r.requestedBy.name } : null,
  resolvedBy: r.resolvedBy ? { id: r.resolvedBy.id, name: r.resolvedBy.name } : null,
});

module.exports = function registerRetentionRequestRoutes(app, prisma) {
  const auth = (...roles) => requireAuth(prisma, roles);
  const include = { tenant: true, requestedBy: true, resolvedBy: true };

  // Lista: el ADMIN solo ve su organización; SYSTEM las ve todas (o acota con ?tenantId=).
  app.get('/api/retention-requests', auth('admin', 'system'), async (req, res) => {
    try {
      const requested = typeof req.query?.tenantId === 'string' && req.query.tenantId ? req.query.tenantId : null;
      const where = req.apiRole === 'admin' ? { tenantId: req.user.tenantId } : requested ? { tenantId: requested } : {};
      const requests = await prisma.retentionExtensionRequest.findMany({ where, orderBy: { createdAt: 'desc' }, include });
      res.json({ status: 'ok', requests: requests.map(toApi) });
    } catch (error) {
      console.error('Error listando solicitudes de extensión:', error);
      fail(res, 500, 'No se pudieron obtener las solicitudes.');
    }
  });


  // Crea la solicitud (solo el administrador de la organización). Debe ser una EXTENSIÓN: un
  // plazo mayor que el vigente. Para cambiar el plan existe la configuración de retención.
  app.post('/api/retention-requests', auth('admin'), async (req, res) => {
    try {
      const { requestedDays, reason = '' } = req.body || {};
      const days = Math.round(Number(requestedDays));
      if (!Number.isFinite(days) || days < MIN_DAYS || days > MAX_DAYS) {
        return fail(res, 400, `El plazo debe estar entre ${MIN_DAYS} y ${MAX_DAYS} días.`);
      }
      if (!req.user.tenantId) return fail(res, 403, 'Tu cuenta no pertenece a una organización.');

      const tenant = await prisma.tenant.findUnique({ where: { id: req.user.tenantId }, select: { id: true, retentionDays: true } });
      if (!tenant) return fail(res, 404, 'Organización no encontrada.');
      if (days <= tenant.retentionDays) {
        return fail(res, 400, 'La extensión debe ser mayor que el plazo vigente. Para cambiarlo, usa la configuración de retención.');
      }

      const open = await prisma.retentionExtensionRequest.findFirst({ where: { tenantId: tenant.id, status: 'PENDING' } });
      if (open) return fail(res, 409, 'Ya tienes una solicitud de extensión pendiente.');

      const request = await prisma.retentionExtensionRequest.create({
        data: {
          status: 'PENDING',
          reason: reason?.trim() || null,
          currentDays: tenant.retentionDays,
          requestedDays: days,
          tenantId: tenant.id,
          requestedById: req.user.id,
        },
        include,
      });
      res.status(201).json({ status: 'ok', request: toApi(request) });
    } catch (error) {
      console.error('Error creando solicitud de extensión:', error);
      fail(res, 500, 'No se pudo crear la solicitud.');
    }
  });

  // Resuelve (aprobar / rechazar): SOLO el administrador del sistema.
  app.patch('/api/retention-requests/:id', auth('system'), async (req, res) => {
    try {
      const { status, resolutionNote = '' } = req.body || {};
      if (!['APPROVED', 'REJECTED'].includes(status)) return fail(res, 400, 'Estado no válido.');

      const request = await prisma.retentionExtensionRequest.findUnique({ where: { id: req.params.id } });
      if (!request) return fail(res, 404, 'Solicitud no encontrada.');

      // Reclamo atómico del paso PENDING → resuelta: dos aprobaciones no aplican dos veces lo mismo.
      const claimed = await prisma.retentionExtensionRequest.updateMany({
        where: { id: request.id, status: 'PENDING' },
        data: {
          status,
          resolutionNote: resolutionNote?.trim() || null,
          resolvedAt: new Date(),
          resolvedById: req.user.id,
        },
      });
      if (claimed.count === 0) return fail(res, 409, 'La solicitud ya fue resuelta.');

      let effect = null;
      if (status === 'APPROVED') {
        const applied = await applyExtension(prisma, { tenantId: request.tenantId, requestedDays: request.requestedDays });
        if (!applied.found) return fail(res, 409, 'La organización ya no existe.');
        await prisma.retentionExtensionRequest.update({ where: { id: request.id }, data: { appliedDays: applied.tenant.retentionDays } });
        effect = { retentionDays: applied.tenant.retentionDays, retentionMode: applied.tenant.retentionMode };
      }

      const updated = await prisma.retentionExtensionRequest.findUnique({ where: { id: request.id }, include });
      res.json({ status: 'ok', request: toApi(updated), effect });
    } catch (error) {
      console.error('Error resolviendo solicitud de extensión:', error);
      fail(res, 500, 'No se pudo resolver la solicitud.');
    }
  });
};
