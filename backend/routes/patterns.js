// Patrones de evaluación (configurador maestro):
//  - Cada patrón guardado es una versión (con nombre y configuración detallada).
//  - Solo un patrón está ACTIVO: es el que usa la IA por defecto.
//  - Un escenario concreto de una organización puede tener un patrón excepcional.
const { requireAuth } = require('../auth');
const { DEFAULT_CONFIG, resolveConfig, deepMerge } = require('../ai/patternConfig');

const fail = (res, code, mensaje) => res.status(code).json({ status: 'error', mensaje });
const AREAS = ['expression', 'voice', 'coherence', 'empathy'];

function toApiPattern(p) {
  return {
    id: p.id,
    version: p.version,
    name: p.name || "Patrón base",
    status: p.status,
    createdAt: p.createdAt,
    createdBy: p.createdBy ? { id: p.createdBy.id, name: p.createdBy.name } : null,
    config: resolveConfig(p),
    overrides: (p.overrides || []).map((o) => ({
      themeId: o.themeId,
      theme: o.theme ? { id: o.theme.id, title: o.theme.title } : null,
      tenant: o.theme?.tenant ? { id: o.theme.tenant.id, name: o.theme.tenant.name } : null,
    })),
    voceroOverrides: (p.voceroOverrides || []).map((o) => ({
      userId: o.userId,
      user: o.user ? { id: o.user.id, name: o.user.name } : null,
      tenant: o.user?.tenant ? { id: o.user.tenant.id, name: o.user.tenant.name } : null,
    })),
  };
}

function validateConfig(config) {
  if (!config?.areas) return 'Falta la configuración de las áreas.';
  const total = AREAS.reduce((s, k) => s + Number(config.areas[k] || 0), 0);
  if (total !== 100) return `Los pesos de las áreas deben sumar 100% (suman ${total}%).`;
  for (const area of ['voice', 'expression', 'coherence', 'empathy']) {
    const criteria = config[area]?.criteria || {};
    const sum = Object.values(criteria).reduce((s, c) => s + Number(c.weight || 0), 0);
    if (sum <= 0) return `El área "${area}" necesita al menos un criterio con peso mayor a 0.`;
  }
  return null;
}

module.exports = function registerPatternRoutes(app, prisma) {
  const auth = (...roles) => requireAuth(prisma, roles);
  const include = {
    createdBy: true,
    overrides: { include: { theme: { include: { tenant: true } } } },
    voceroOverrides: { include: { user: { include: { tenant: true } } } },
  };

  app.get('/api/patterns', auth('master', 'system'), async (req, res) => {
    try {
      const patterns = await prisma.masterPattern.findMany({ orderBy: { version: 'desc' }, include });
      res.json({ status: 'ok', defaults: DEFAULT_CONFIG, patterns: patterns.map(toApiPattern) });
    } catch (error) {
      console.error('Error listando patrones:', error);
      fail(res, 500, 'No se pudieron obtener los patrones.');
    }
  });

  // Guarda una nueva versión. activate=true la deja como patrón activo; si no, queda como borrador.
  app.post('/api/patterns', auth('master'), async (req, res) => {
    try {
      const { name, activate = false } = req.body || {};
      // Lo que no venga en la configuración se completa con los valores recomendados
      const config = deepMerge(DEFAULT_CONFIG, req.body?.config || {});
      const invalid = validateConfig(config);
      if (invalid) return fail(res, 400, invalid);

      const pattern = await prisma.$transaction(async (tx) => {
        const last = await tx.masterPattern.findFirst({ orderBy: { version: 'desc' } });
        if (activate) await tx.masterPattern.updateMany({ where: { status: 'ACTIVE' }, data: { status: 'INACTIVE' } });
        return tx.masterPattern.create({
          data: {
            version: (last?.version || 0) + 1,
            status: activate ? 'ACTIVE' : 'DRAFT',
            name: name?.trim() || null,
            config,
            // Columnas originales del modelo (compatibilidad con el endpoint anterior)
            expressionWeight: Number(config.areas.expression),
            voiceToneWeight: Number(config.areas.voice),
            coherenceWeight: Number(config.areas.coherence),
            empathyWeight: Number(config.areas.empathy),
            empathyLevel: config.strictness || 'normal',
            empathyDescription: config.empathy?.descriptor || '',
            createdById: req.user.id,
          },
          include,
        });
      });
      res.status(201).json({ status: 'ok', pattern: toApiPattern(pattern) });
    } catch (error) {
      console.error('Error guardando patrón:', error);
      fail(res, 500, 'No se pudo guardar el patrón.');
    }
  });

  // Elegir qué patrón usa la IA por defecto
  app.post('/api/patterns/:id/activate', auth('master'), async (req, res) => {
    try {
      const pattern = await prisma.masterPattern.findUnique({ where: { id: req.params.id } });
      if (!pattern) return fail(res, 404, 'Patrón no encontrado.');
      await prisma.$transaction([
        prisma.masterPattern.updateMany({ where: { status: 'ACTIVE', NOT: { id: pattern.id } }, data: { status: 'INACTIVE' } }),
        prisma.masterPattern.update({ where: { id: pattern.id }, data: { status: 'ACTIVE' } }),
      ]);
      res.json({ status: 'ok' });
    } catch (error) {
      console.error('Error activando patrón:', error);
      fail(res, 500, 'No se pudo activar el patrón.');
    }
  });

  // Escenarios de todas las organizaciones (para asignar patrones excepcionales)
  app.get('/api/patterns/themes', auth('master', 'system'), async (req, res) => {
    try {
      const themes = await prisma.theme.findMany({
        orderBy: [{ tenant: { name: 'asc' } }, { title: 'asc' }],
        include: { tenant: true, patternOverride: { include: { pattern: true } } },
      });
      res.json({
        status: 'ok',
        themes: themes.map((t) => ({
          id: t.id,
          title: t.title,
          tenant: { id: t.tenant.id, name: t.tenant.name },
          override: t.patternOverride
            ? { patternId: t.patternOverride.patternId, name: t.patternOverride.pattern.name || "Patrón base" }
            : null,
        })),
      });
    } catch (error) {
      console.error('Error listando escenarios:', error);
      fail(res, 500, 'No se pudieron obtener los escenarios.');
    }
  });

  // Asignar (o cambiar) el patrón excepcional de un escenario
  app.put('/api/pattern-overrides/:themeId', auth('master'), async (req, res) => {
    try {
      const { patternId } = req.body || {};
      const [theme, pattern] = await Promise.all([
        prisma.theme.findUnique({ where: { id: req.params.themeId } }),
        prisma.masterPattern.findUnique({ where: { id: patternId || '' } }),
      ]);
      if (!theme) return fail(res, 404, 'Escenario no encontrado.');
      if (!pattern) return fail(res, 404, 'Patrón no encontrado.');
      await prisma.patternOverride.upsert({
        where: { themeId: theme.id },
        update: { patternId: pattern.id },
        create: { themeId: theme.id, patternId: pattern.id },
      });
      res.json({ status: 'ok' });
    } catch (error) {
      console.error('Error asignando patrón excepcional:', error);
      fail(res, 500, 'No se pudo asignar el patrón.');
    }
  });

  app.delete('/api/pattern-overrides/:themeId', auth('master'), async (req, res) => {
    try {
      await prisma.patternOverride.deleteMany({ where: { themeId: req.params.themeId } });
      res.json({ status: 'ok' });
    } catch (error) {
      console.error('Error quitando patrón excepcional:', error);
      fail(res, 500, 'No se pudo quitar el patrón.');
    }
  });

  // Voceros de todas las organizaciones (para asignar patrones excepcionales por persona)
  app.get('/api/patterns/voceros', auth('master', 'system'), async (req, res) => {
    try {
      const voceros = await prisma.user.findMany({
        where: { role: 'VOCERO', ...(req.query.tenantId ? { tenantId: req.query.tenantId } : {}) },
        orderBy: [{ tenant: { name: 'asc' } }, { name: 'asc' }],
        include: { tenant: true, patternOverride: { include: { pattern: true } } },
      });
      res.json({
        status: 'ok',
        voceros: voceros.map((u) => ({
          id: u.id,
          name: u.name,
          email: u.email,
          area: u.area,
          tenant: u.tenant ? { id: u.tenant.id, name: u.tenant.name } : null,
          override: u.patternOverride
            ? { patternId: u.patternOverride.patternId, name: u.patternOverride.pattern.name || 'Patrón base' }
            : null,
        })),
      });
    } catch (error) {
      console.error('Error listando voceros:', error);
      fail(res, 500, 'No se pudieron obtener los voceros.');
    }
  });

  // Asignar (o cambiar) el patrón excepcional de un vocero
  app.put('/api/pattern-overrides/vocero/:userId', auth('master'), async (req, res) => {
    try {
      const { patternId } = req.body || {};
      const [user, pattern] = await Promise.all([
        prisma.user.findUnique({ where: { id: req.params.userId } }),
        prisma.masterPattern.findUnique({ where: { id: patternId || '' } }),
      ]);
      if (!user || user.role !== 'VOCERO') return fail(res, 404, 'Vocero no encontrado.');
      if (!pattern) return fail(res, 404, 'Patrón no encontrado.');
      await prisma.voceroPatternOverride.upsert({
        where: { userId: user.id },
        update: { patternId: pattern.id },
        create: { userId: user.id, patternId: pattern.id },
      });
      res.json({ status: 'ok' });
    } catch (error) {
      console.error('Error asignando patrón al vocero:', error);
      fail(res, 500, 'No se pudo asignar el patrón.');
    }
  });

  app.delete('/api/pattern-overrides/vocero/:userId', auth('master'), async (req, res) => {
    try {
      await prisma.voceroPatternOverride.deleteMany({ where: { userId: req.params.userId } });
      res.json({ status: 'ok' });
    } catch (error) {
      console.error('Error quitando patrón del vocero:', error);
      fail(res, 500, 'No se pudo quitar el patrón.');
    }
  });

  // Resumen para el panel maestro
  app.get('/api/master/overview', auth('master', 'system'), async (req, res) => {
    try {
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const [tenants, sessionsWeek, evaluated, active, reviewed] = await Promise.all([
        prisma.tenant.count({ where: { status: 'ACTIVE' } }),
        prisma.session.count({ where: { createdAt: { gte: weekAgo } } }),
        prisma.session.findMany({ where: { score: { not: null } }, select: { score: true, review: true } }),
        prisma.masterPattern.findFirst({ where: { status: 'ACTIVE' }, orderBy: { version: 'desc' }, include }),
        prisma.session.count({ where: { review: { not: null } } }),
      ]);

      // Acuerdo IA-humano: % de áreas revisadas donde la diferencia fue ≤ 10 puntos
      const diffs = evaluated.flatMap((s) => Object.values(s.review?.agreement || {}).filter((d) => d != null));
      const agreement = diffs.length ? Math.round((diffs.filter((d) => d <= 10).length / diffs.length) * 100) : null;

      const buckets = [30, 40, 50, 60, 70, 80, 90].map((from) => ({
        range: String(from),
        count: evaluated.filter((s) => s.score >= from && (from === 90 ? s.score <= 100 : s.score < from + 10)).length,
      }));
      buckets[0].count += evaluated.filter((s) => s.score < 30).length;

      res.json({
        status: 'ok',
        tenants,
        sessionsWeek,
        evaluated: evaluated.length,
        pendingReview: evaluated.length - reviewed,
        agreement,
        histogram: buckets,
        activePattern: active ? toApiPattern(active) : null,
      });
    } catch (error) {
      console.error('Error en resumen maestro:', error);
      fail(res, 500, 'No se pudo obtener el resumen.');
    }
  });
};
