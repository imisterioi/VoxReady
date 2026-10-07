// Rutas de métricas administrativas (solo lectura).
//
//   GET /api/metrics/overview → resumen combinado del dashboard                      [admin, system]
//   GET /api/metrics/voceros  → ranking de VOCEROS vigentes (más / menos)             [admin, system]
//   GET /api/metrics/themes   → preferencia de temas (más / menos usados)             [admin, system]
//   GET /api/metrics/tenants  → clientes actuales + creados en el período              [system]
//
// Todas aceptan ?period= (7 | 30 | 90 | 365 | all). El alcance lo define el rol del token:
//   ADMIN  → su organización (req.user.tenantId). Nunca la de otro.
//   SYSTEM → global; puede acotar con ?tenantId= (validado contra la BD).
//   VOCERO y MASTER (configurador) → SIN acceso a este dashboard.
const { requireAuth } = require('../auth');
const {
  resolvePeriod,
  resolveScope,
  voceroRankings,
  themePreference,
  tenantMetrics,
  metricsOverview,
} = require('../lib/metrics');

module.exports = function registerMetricsRoutes(app, prisma) {
  const auth = (...roles) => requireAuth(prisma, roles);
  const fail = (res, code, mensaje) => res.status(code).json({ status: 'error', mensaje });

  // Overview combinado del dashboard: resumen + rankings + temas + organizaciones.
  // El alcance lo determina el backend desde el token; solo SYSTEM admite ?tenantId=
  // (validado contra la BD). Un ADMIN ignora cualquier ?tenantId=.
  app.get('/api/metrics/overview', auth('admin', 'system'), async (req, res) => {
    try {
      const period = resolvePeriod(req.query);
      const scope = await resolveScope(prisma, req);
      if (scope.invalidTenant) return fail(res, 400, 'La organización indicada no existe.');
      const overview = await metricsOverview(prisma, { scope, from: period.from, to: period.to });
      res.json({ status: 'ok', period, ...overview });
    } catch (error) {
      console.error('Error en el resumen de métricas:', error);
      fail(res, 500, 'No se pudo obtener el resumen de métricas.');
    }
  });

  // Ranking de voceros vigentes por entrenamientos (más y menos).
  app.get('/api/metrics/voceros', auth('admin', 'system'), async (req, res) => {
    try {
      const period = resolvePeriod(req.query);
      const scope = await resolveScope(prisma, req);
      if (scope.invalidTenant) return fail(res, 400, 'La organización indicada no existe.');
      const rankings = await voceroRankings(prisma, { tenantId: scope.tenantId, from: period.from, to: period.to });
      res.json({ status: 'ok', period, scope: scope.mode, ...rankings });
    } catch (error) {
      console.error('Error en ranking de voceros:', error);
      fail(res, 500, 'No se pudo obtener el ranking de voceros.');
    }
  });

  // Preferencia de temas (más y menos usados) por sesiones COMPLETED del período.
  app.get('/api/metrics/themes', auth('admin', 'system'), async (req, res) => {
    try {
      const period = resolvePeriod(req.query);
      const scope = await resolveScope(prisma, req);
      if (scope.invalidTenant) return fail(res, 400, 'La organización indicada no existe.');
      const preference = await themePreference(prisma, { tenantId: scope.tenantId, from: period.from, to: period.to });
      res.json({ status: 'ok', period, scope: scope.mode, ...preference });
    } catch (error) {
      console.error('Error en preferencia de temas:', error);
      fail(res, 500, 'No se pudo obtener la preferencia de temas.');
    }
  });

  // Clientes: actuales (ACTIVE) y creados en el período. Solo el Administrador del Sistema.
  app.get('/api/metrics/tenants', auth('system'), async (req, res) => {
    try {
      const period = resolvePeriod(req.query);
      const metrics = await tenantMetrics(prisma, { from: period.from, to: period.to });
      res.json({ status: 'ok', period, ...metrics });
    } catch (error) {
      console.error('Error en métricas de clientes:', error);
      fail(res, 500, 'No se pudieron obtener las métricas de clientes.');
    }
  });
};
