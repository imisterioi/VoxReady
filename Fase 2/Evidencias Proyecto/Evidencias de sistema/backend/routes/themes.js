// Temas/escenarios del administrador del cliente, asignación a voceros,
// política de retención y resumen del panel del cliente.
// (La creación de temas es POST /api/themes, en index.js.)
const { requireAuth } = require('../auth');
const { parseList } = require('../ai/interviewer');
const { normalizeInterviewConfig, resolveInterviewConfig } = require('../ai/interviewConfig');

const fail = (res, code, mensaje) => res.status(code).json({ status: 'error', mensaje });

const toApiTheme = (t) => ({
  id: t.id,
  title: t.title,
  context: t.context,
  category: t.category,
  optic: t.optic,
  keyMessages: parseList(t.keyMessages),
  redLines: parseList(t.redLines),
  publics: parseList(t.publics),
  availableToAllVoceros: t.availableToAllVoceros,
  interview: resolveInterviewConfig(t),
  voceroIds: (t.assignments || []).map((a) => a.userId),
  sessions: t._count?.sessions ?? 0,
});

// Sincroniza las asignaciones de un tema con la lista de voceros elegida
async function syncAssignments(prisma, theme, voceroIds = []) {
  const voceros = await prisma.user.findMany({
    where: { id: { in: voceroIds }, tenantId: theme.tenantId, role: 'VOCERO' },
    select: { id: true },
  });
  const wanted = new Set(voceros.map((v) => v.id));
  const current = await prisma.scenarioAssignment.findMany({ where: { themeId: theme.id } });

  for (const a of current) {
    if (!wanted.has(a.userId)) {
      await prisma.scenarioRubric.deleteMany({ where: { assignmentId: a.id } });
      await prisma.scenarioAssignment.delete({ where: { id: a.id } });
    }
  }
  for (const userId of wanted) {
    await prisma.scenarioAssignment.upsert({
      where: { userId_themeId: { userId, themeId: theme.id } },
      update: {},
      create: { userId, themeId: theme.id },
    });
  }
}

module.exports = function registerThemeRoutes(app, prisma) {
  const auth = (...roles) => requireAuth(prisma, roles);
  const include = { assignments: { select: { userId: true } }, _count: { select: { sessions: true } } };

  app.get('/api/themes', auth('admin'), async (req, res) => {
    try {
      const themes = await prisma.theme.findMany({
        where: { tenantId: req.user.tenantId, deletedAt: null },
        orderBy: { title: 'asc' },
        include,
      });
      res.json({ status: 'ok', themes: themes.map(toApiTheme) });
    } catch (error) {
      console.error('Error listando temas:', error);
      fail(res, 500, 'No se pudieron obtener los temas.');
    }
  });

  app.get('/api/themes/:id', auth('admin'), async (req, res) => {
    try {
      const theme = await prisma.theme.findUnique({ where: { id: req.params.id }, include });
      if (!theme || theme.tenantId !== req.user.tenantId || theme.deletedAt) return fail(res, 404, 'Tema no encontrado.');
      res.json({ status: 'ok', theme: toApiTheme(theme) });
    } catch (error) {
      console.error('Error obteniendo tema:', error);
      fail(res, 500, 'No se pudo obtener el tema.');
    }
  });

  app.put('/api/themes/:id', auth('admin'), async (req, res) => {
    try {
      const theme = await prisma.theme.findUnique({ where: { id: req.params.id } });
      if (!theme || theme.tenantId !== req.user.tenantId || theme.deletedAt) return fail(res, 404, 'Tema no encontrado.');

      const { title, context, keyMessages = [], redLines = [], publics = [], optic, category, availableToAllVoceros, voceroIds = [] } = req.body || {};
      if (!title?.trim() || !context?.trim()) return fail(res, 400, 'El nombre y el contexto son obligatorios.');
      if (!keyMessages.length) return fail(res, 400, 'Agrega al menos un mensaje clave.');

      const duplicated = await prisma.theme.findFirst({
        where: { tenantId: theme.tenantId, title: title.trim(), NOT: { id: theme.id } },
      });
      if (duplicated) return fail(res, 409, 'Ya existe otro tema con ese nombre.');

      const updated = await prisma.theme.update({
        where: { id: theme.id },
        data: {
          title: title.trim(),
          context: context.trim(),
          keyMessages: JSON.stringify(keyMessages),
          redLines: JSON.stringify(redLines),
          publics: JSON.stringify(publics),
          optic: optic || null,
          category: category || theme.category,
          availableToAllVoceros: Boolean(availableToAllVoceros),
          // Si no se envía, se conserva la configuración de entrevista actual
          ...(req.body.interview !== undefined ? { interviewConfig: normalizeInterviewConfig(req.body.interview) } : {}),
        },
      });
      await syncAssignments(prisma, updated, voceroIds);

      const fresh = await prisma.theme.findUnique({ where: { id: theme.id }, include });
      res.json({ status: 'ok', theme: toApiTheme(fresh) });
    } catch (error) {
      console.error('Error actualizando tema:', error);
      fail(res, 500, 'No se pudo actualizar el tema.');
    }
  });

  // ------------------------------------------------ Asignación de voceros

  // Reemplaza los voceros con acceso a un tema (reutiliza ScenarioAssignment)
  app.put('/api/themes/:id/assignments', auth('admin'), async (req, res) => {
    try {
      const theme = await prisma.theme.findUnique({ where: { id: req.params.id } });
      if (!theme || theme.tenantId !== req.user.tenantId || theme.deletedAt) return fail(res, 404, 'Tema no encontrado.');

      const { voceroIds = [], availableToAllVoceros } = req.body || {};
      if (!Array.isArray(voceroIds)) return fail(res, 400, 'Lista de voceros no válida.');
      const all = typeof availableToAllVoceros === 'boolean' ? availableToAllVoceros : theme.availableToAllVoceros;

      const updated = await prisma.theme.update({
        where: { id: theme.id },
        data: { availableToAllVoceros: all },
      });
      // syncAssignments valida que cada vocero pertenezca al tenant del tema
      await syncAssignments(prisma, updated, all ? [] : voceroIds);

      const fresh = await prisma.theme.findUnique({ where: { id: theme.id }, include });
      res.json({ status: 'ok', theme: toApiTheme(fresh) });
    } catch (error) {
      console.error('Error guardando asignaciones:', error);
      fail(res, 500, 'No se pudieron guardar las asignaciones.');
    }
  });

  // ------------------------------------------------ Eliminar tema

  // Borrado lógico: el tema deja de estar disponible pero conserva el histórico
  // (asignaciones, sesiones, informes y videos) según la política de retención.
  app.delete('/api/themes/:id', auth('admin'), async (req, res) => {
    try {
      const theme = await prisma.theme.findUnique({ where: { id: req.params.id } });
      if (!theme || theme.tenantId !== req.user.tenantId || theme.deletedAt) return fail(res, 404, 'Tema no encontrado.');

      await prisma.theme.update({ where: { id: theme.id }, data: { deletedAt: new Date() } });
      res.json({ status: 'ok' });
    } catch (error) {
      console.error('Error eliminando tema:', error);
      fail(res, 500, 'No se pudo eliminar el tema.');
    }
  });

  // ------------------------------------------------ Estilo de la organización

  // Colores con los que los voceros de la organización ven la plataforma
  const HEX = /^#[0-9a-f]{6}$/i;
  const toBranding = (t) => ({ brandColor: t.brandColor, accentColor: t.accentColor, name: t.name });

  app.get('/api/tenant/branding', auth('admin'), async (req, res) => {
    try {
      const tenant = await prisma.tenant.findUnique({ where: { id: req.user.tenantId } });
      res.json({ status: 'ok', branding: toBranding(tenant) });
    } catch (error) {
      console.error('Error obteniendo estilo:', error);
      fail(res, 500, 'No se pudo obtener el estilo.');
    }
  });

  // Enviar ambos colores en null vuelve a los colores de VoxReady
  app.put('/api/tenant/branding', auth('admin'), async (req, res) => {
    try {
      const { brandColor = null, accentColor = null } = req.body || {};
      const reset = brandColor == null && accentColor == null;
      if (!reset && (!HEX.test(brandColor || '') || !HEX.test(accentColor || ''))) {
        return fail(res, 400, 'Los colores deben tener el formato #RRGGBB.');
      }
      const tenant = await prisma.tenant.update({
        where: { id: req.user.tenantId },
        data: reset ? { brandColor: null, accentColor: null } : { brandColor: brandColor.toUpperCase(), accentColor: accentColor.toUpperCase() },
      });
      res.json({ status: 'ok', branding: toBranding(tenant) });
    } catch (error) {
      console.error('Error guardando estilo:', error);
      fail(res, 500, 'No se pudo guardar el estilo.');
    }
  });

  // ------------------------------------------------ Política de retención

  app.get('/api/tenant/settings', auth('admin'), async (req, res) => {
    const tenant = await prisma.tenant.findUnique({ where: { id: req.user.tenantId } });
    res.json({ status: 'ok', settings: { retentionMode: tenant.retentionMode, retentionDays: tenant.retentionDays, name: tenant.name } });
  });

  app.put('/api/tenant/settings', auth('admin'), async (req, res) => {
    try {
      const { retentionMode, retentionDays } = req.body || {};
      if (!['FULL', 'METRICS'].includes(retentionMode)) return fail(res, 400, 'Modo de retención no válido.');
      const days = Math.round(Number(retentionDays));
      if (!Number.isFinite(days) || days < 1 || days > 3650) return fail(res, 400, 'El plazo debe estar entre 1 y 3650 días.');
      const tenant = await prisma.tenant.update({ where: { id: req.user.tenantId }, data: { retentionMode, retentionDays: days } });
      res.json({ status: 'ok', settings: { retentionMode: tenant.retentionMode, retentionDays: tenant.retentionDays } });
    } catch (error) {
      console.error('Error guardando retención:', error);
      fail(res, 500, 'No se pudo guardar la política.');
    }
  });

  // ------------------------------------------------ Resumen del cliente

  app.get('/api/admin/overview', auth('admin'), async (req, res) => {
    try {
      const tenantId = req.user.tenantId;
      const month = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
      const [themes, voceros, sessionsMonth, scored] = await Promise.all([
        prisma.theme.count({ where: { tenantId } }),
        prisma.user.count({ where: { tenantId, role: 'VOCERO', status: 'ACTIVE' } }),
        prisma.session.count({ where: { tenantId, createdAt: { gte: month } } }),
        prisma.session.aggregate({ where: { tenantId, score: { not: null } }, _avg: { score: true }, _count: true }),
      ]);
      res.json({
        status: 'ok',
        themes,
        voceros,
        sessionsMonth,
        evaluated: scored._count,
        avgScore: scored._avg.score != null ? Math.round(scored._avg.score) : null,
      });
    } catch (error) {
      console.error('Error en resumen del cliente:', error);
      fail(res, 500, 'No se pudo obtener el resumen.');
    }
  });
};
