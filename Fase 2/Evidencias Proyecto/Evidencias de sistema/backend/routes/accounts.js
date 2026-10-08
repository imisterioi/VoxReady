// Rutas de cuentas: login, organizaciones (tenants), usuarios y resumen del sistema.
//
// Jerarquía de creación de usuarios:
//   SYSTEM (staff VoxReady) → crea organizaciones con su primer ADMIN, más ADMIN,
//                             MASTER y SYSTEM. Suspende/reactiva cualquier cuenta.
//   ADMIN (cliente)         → crea y suspende los VOCERO de su organización.
//   MASTER / VOCERO         → no crean usuarios.
const {
  ROLE_FROM_API,
  hashPassword,
  verifyPassword,
  createToken,
  toApiUser,
  requireAuth,
} = require('../auth');
const { anonymizeUser } = require('../lib/anonymize');
const { syncUserPause } = require('../lib/retentionPause');
const { startTenantDeletion, processTenantDeletion } = require('../lib/tenantDeletion');
const presence = require('../lib/presence');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 6;

const fail = (res, code, mensaje) => res.status(code).json({ status: 'error', mensaje });

const startOfMonth = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1);
};

// Valida los datos básicos de un usuario nuevo. Devuelve un mensaje de error o null.
async function validateNewUser(prisma, { name, email, password }) {
  if (!name?.trim()) return 'Ingresa el nombre completo.';
  if (!EMAIL_RE.test(email?.trim() || '')) return 'Ingresa un correo válido.';
  if (!password || password.length < MIN_PASSWORD) return `La contraseña debe tener al menos ${MIN_PASSWORD} caracteres.`;
  const exists = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (exists) return 'Ya existe un usuario con ese correo.';
  return null;
}

module.exports = function registerAccountRoutes(app, prisma) {
  const auth = (...roles) => requireAuth(prisma, roles);

  // ------------------------------------------------------------ Login

  app.post('/api/auth/login', async (req, res) => {
    try {
      const email = (req.body?.email || '').trim().toLowerCase();
      const password = req.body?.password || '';

      const user = await prisma.user.findUnique({ where: { email }, include: { tenant: true } });

      if (!user || !verifyPassword(password, user.passwordHash)) {
        return fail(res, 401, 'Correo o contraseña incorrectos.');
      }
      if (user.status === 'SUSPENDED') return fail(res, 403, 'Esta cuenta está suspendida. Contacta a tu administrador.');
      if (user.tenant?.status === 'SUSPENDED') return fail(res, 403, `La organización ${user.tenant.name} está suspendida.`);
      if (user.tenant?.status === 'DELETING') return fail(res, 403, `La organización ${user.tenant.name} está siendo eliminada.`);

      const updated = await prisma.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
        include: { tenant: true },
      });

      res.json({ status: 'ok', token: createToken(updated), user: toApiUser(updated) });
    } catch (error) {
      console.error('Error en login:', error);
      fail(res, 500, 'No se pudo iniciar sesión.');
    }
  });

  app.get('/api/auth/me', auth(), (req, res) => {
    res.json({ status: 'ok', user: toApiUser(req.user) });
  });

  // Latido del frontend: mantiene al usuario como "conectado" (lo registra requireAuth)
  app.post('/api/auth/heartbeat', auth(), (req, res) => {
    res.json({ status: 'ok' });
  });

  // Cierre de sesión: el usuario deja de contarse como conectado de inmediato
  app.post('/api/auth/logout', auth(), (req, res) => {
    presence.forget(req.user.id);
    res.json({ status: 'ok' });
  });

  // ---------------------------------------------------- Organizaciones

  app.get('/api/tenants', auth('system'), async (req, res) => {
    try {
      const month = startOfMonth();
      const tenants = await prisma.tenant.findMany({
        orderBy: { createdAt: 'desc' },
        include: {
          users: { select: { id: true, name: true, email: true, role: true, status: true } },
          _count: { select: { sessions: { where: { createdAt: { gte: month } } } } },
        },
      });

      res.json({
        status: 'ok',
        tenants: tenants.map((t) => ({
          id: t.id,
          name: t.name,
          sector: t.sector,
          status: t.status,
          createdAt: t.createdAt,
          sessionsMonth: t._count.sessions,
          admins: t.users.filter((u) => u.role === 'ADMIN').map(({ id, name, email }) => ({ id, name, email })),
          voceros: t.users.filter((u) => u.role === 'VOCERO').length,
        })),
      });
    } catch (error) {
      console.error('Error listando organizaciones:', error);
      fail(res, 500, 'No se pudieron obtener las organizaciones.');
    }
  });

  // Crea una organización junto con su primer administrador
  app.post('/api/tenants', auth('system'), async (req, res) => {
    try {
      const { name, sector, adminName, adminEmail, adminPassword } = req.body || {};
      if (!name?.trim()) return fail(res, 400, 'Ingresa el nombre de la organización.');

      const duplicated = await prisma.tenant.findFirst({ where: { name: { equals: name.trim(), mode: 'insensitive' } } });
      if (duplicated) return fail(res, 409, 'Ya existe una organización con ese nombre.');

      const invalid = await validateNewUser(prisma, { name: adminName, email: adminEmail, password: adminPassword });
      if (invalid) return fail(res, 400, invalid);

      const result = await prisma.$transaction(async (tx) => {
        const tenant = await tx.tenant.create({ data: { name: name.trim(), sector: sector || null } });
        const admin = await tx.user.create({
          data: {
            name: adminName.trim(),
            email: adminEmail.trim().toLowerCase(),
            role: 'ADMIN',
            passwordHash: hashPassword(adminPassword),
            tenantId: tenant.id,
          },
          include: { tenant: true },
        });
        return { tenant, admin };
      });

      res.status(201).json({ status: 'ok', tenant: result.tenant, admin: toApiUser(result.admin) });
    } catch (error) {
      console.error('Error creando organización:', error);
      fail(res, 500, 'No se pudo crear la organización.');
    }
  });

  app.patch('/api/tenants/:id', auth('system'), async (req, res) => {
    try {
      const { status } = req.body || {};
      if (!['ACTIVE', 'SUSPENDED'].includes(status)) return fail(res, 400, 'Estado no válido.');
      const existing = await prisma.tenant.findUnique({ where: { id: req.params.id } });
      if (!existing) return fail(res, 404, 'Organización no encontrada.');
      if (existing.status === 'DELETING') return fail(res, 409, 'La organización está en proceso de eliminación.');
      // Cambia el estado y ajusta las pausas de retención de TODOS los voceros del tenant (atómico).
      const tenant = await prisma.$transaction(async (tx) => {
        const updated = await tx.tenant.update({ where: { id: req.params.id }, data: { status } });
        const users = await tx.user.findMany({ where: { tenantId: updated.id }, select: { id: true } });
        for (const u of users) await syncUserPause(tx, u.id);
        // Historial para las métricas de clientes (solo si el estado realmente cambió)
        if (existing.status !== status) {
          await tx.tenantEvent.create({
            data: { tenantId: updated.id, type: status === 'SUSPENDED' ? 'SUSPENDED' : 'REACTIVATED', tenantCreatedAt: updated.createdAt },
          });
        }
        return updated;
      });
      res.json({ status: 'ok', tenant });
    } catch (error) {
      console.error('Error actualizando organización:', error);
      fail(res, 500, 'No se pudo actualizar la organización.');
    }
  });

  // Elimina manualmente un tenant (marca DELETING y procesa; reintentable si algo falla).
  // No toca los escenarios globales. Acceso: SYSTEM / MASTER. Operación irreversible.
  app.delete('/api/tenants/:id', auth('system', 'master'), async (req, res) => {
    try {
      const tenant = await prisma.tenant.findUnique({ where: { id: req.params.id } });
      if (!tenant) return fail(res, 404, 'Organización no encontrada.');
      if (tenant.status === 'DELETING') return fail(res, 409, 'La organización ya está en proceso de eliminación.');

      await startTenantDeletion(prisma, tenant.id);
      // Procesa de inmediato (best-effort); si algo falla queda en DELETING y el job reintenta.
      let deletion = 'pending';
      try {
        deletion = (await processTenantDeletion(prisma, tenant.id)).status;
      } catch (error) {
        console.warn('[Eliminación] fallo en el intento inmediato:', error.message);
      }
      res.json({ status: 'ok', deletion }); // 'completed' | 'pending' (DELETING)
    } catch (error) {
      console.error('Error eliminando organización:', error);
      fail(res, 500, 'No se pudo eliminar la organización.');
    }
  });

  // ------------------------------------------------------------ Usuarios

  // SYSTEM ve todos; ADMIN ve solo los voceros de su organización
  app.get('/api/users', auth('system', 'admin'), async (req, res) => {
    try {
      const where = req.apiRole === 'admin' ? { tenantId: req.user.tenantId, role: 'VOCERO' } : {};
      const users = await prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: { tenant: true, _count: { select: { sessions: { where: { status: 'COMPLETED' } } } } },
      });
      res.json({
        status: 'ok',
        users: users.map((u) => ({ ...toApiUser(u), sessions: u._count.sessions })),
      });
    } catch (error) {
      console.error('Error listando usuarios:', error);
      fail(res, 500, 'No se pudieron obtener los usuarios.');
    }
  });

  app.post('/api/users', auth('system', 'admin'), async (req, res) => {
    try {
      const { name, email, password, role, tenantId, area } = req.body || {};

      // Qué roles puede crear cada uno
      const allowed = req.apiRole === 'system' ? ['admin', 'master', 'system'] : ['user'];
      if (!allowed.includes(role)) return fail(res, 403, 'No puedes crear usuarios con ese rol.');

      const invalid = await validateNewUser(prisma, { name, email, password });
      if (invalid) return fail(res, 400, invalid);

      // El admin crea voceros en su organización; el admin de cliente creado por SYSTEM necesita una
      let finalTenantId = null;
      if (req.apiRole === 'admin') {
        finalTenantId = req.user.tenantId;
      } else if (role === 'admin') {
        const tenant = tenantId && (await prisma.tenant.findUnique({ where: { id: tenantId } }));
        if (!tenant) return fail(res, 400, 'Selecciona una organización.');
        finalTenantId = tenant.id;
      }

      const user = await prisma.user.create({
        data: {
          name: name.trim(),
          email: email.trim().toLowerCase(),
          role: ROLE_FROM_API[role],
          passwordHash: hashPassword(password),
          tenantId: finalTenantId,
          area: role === 'user' ? area || null : null,
        },
        include: { tenant: true },
      });

      res.status(201).json({ status: 'ok', user: toApiUser(user) });
    } catch (error) {
      console.error('Error creando usuario:', error);
      fail(res, 500, 'No se pudo crear el usuario.');
    }
  });

  app.patch('/api/users/:id', auth('system', 'admin'), async (req, res) => {
    try {
      const { status } = req.body || {};
      if (!['ACTIVE', 'SUSPENDED'].includes(status)) return fail(res, 400, 'Estado no válido.');
      if (req.params.id === req.user.id) return fail(res, 400, 'No puedes suspender tu propia cuenta.');

      const target = await prisma.user.findUnique({ where: { id: req.params.id } });
      if (!target) return fail(res, 404, 'Usuario no encontrado.');
      if (req.apiRole === 'admin' && (target.tenantId !== req.user.tenantId || target.role !== 'VOCERO')) {
        return fail(res, 403, 'Solo puedes gestionar voceros de tu organización.');
      }

      const user = await prisma.$transaction(async (tx) => {
        const updated = await tx.user.update({ where: { id: target.id }, data: { status }, include: { tenant: true } });
        await syncUserPause(tx, target.id); // abre/cierra el intervalo de pausa de retención del vocero
        return updated;
      });
      res.json({ status: 'ok', user: toApiUser(user) });
    } catch (error) {
      console.error('Error actualizando usuario:', error);
      fail(res, 500, 'No se pudo actualizar el usuario.');
    }
  });

  // ------------------------------------------------ Anonimización (Bloque A)

  // Anonimiza un vocero (usuario + sesiones + videos). Solo voceros.
  // ADMIN: únicamente voceros de su organización. SYSTEM: cualquier vocero.
  app.post('/api/users/:id/anonymize', auth('system', 'admin'), async (req, res) => {
    try {
      const target = await prisma.user.findUnique({ where: { id: req.params.id } });
      if (!target) return fail(res, 404, 'Usuario no encontrado.');
      if (target.role !== 'VOCERO') return fail(res, 403, 'Solo se pueden anonimizar voceros.');
      if (req.apiRole === 'admin' && target.tenantId !== req.user.tenantId) {
        return fail(res, 403, 'Solo puedes anonimizar voceros de tu organización.');
      }
      if (target.anonymizedAt) return fail(res, 409, 'Este vocero ya fue anonimizado.');

      const result = await anonymizeUser(prisma, target.id);
      const fresh = await prisma.user.findUnique({ where: { id: target.id }, include: { tenant: true } });
      res.json({ status: 'ok', user: toApiUser(fresh), result });
    } catch (error) {
      console.error('Error anonimizando usuario:', error);
      fail(res, 500, 'No se pudo anonimizar el vocero.');
    }
  });

  // Elimina manualmente un VOCERO: procesa sus datos de inmediato (no espera la retención).
  // Reutiliza la misma lógica que la anonimización. No confundir con suspender.
  app.delete('/api/users/:id', auth('system', 'admin'), async (req, res) => {
    try {
      const target = await prisma.user.findUnique({ where: { id: req.params.id } });
      if (!target) return fail(res, 404, 'Usuario no encontrado.');
      if (target.role !== 'VOCERO') return fail(res, 403, 'Solo se pueden eliminar voceros.');
      if (req.apiRole === 'admin' && target.tenantId !== req.user.tenantId) {
        return fail(res, 403, 'Solo puedes eliminar voceros de tu organización.');
      }
      const result = await anonymizeUser(prisma, target.id);
      res.json({ status: 'ok', result });
    } catch (error) {
      console.error('Error eliminando usuario:', error);
      fail(res, 500, 'No se pudo eliminar el vocero.');
    }
  });

  // ------------------------------------------------- Resumen del sistema

  app.get('/api/system/overview', auth('system'), async (req, res) => {
    try {
      const since = new Date();
      since.setHours(0, 0, 0, 0);
      since.setDate(since.getDate() - 13);

      const [tenants, users, sessions, recentUsers, recentSessions, patterns] = await Promise.all([
        prisma.tenant.findMany({ select: { status: true } }),
        prisma.user.findMany({ select: { role: true, status: true } }),
        prisma.session.findMany({ where: { createdAt: { gte: since } }, select: { createdAt: true } }),
        prisma.user.findMany({ orderBy: { createdAt: 'desc' }, take: 5, include: { tenant: true } }),
        prisma.session.findMany({
          where: { status: 'COMPLETED' },
          orderBy: { createdAt: 'desc' },
          take: 5,
          include: { user: true, theme: true },
        }),
        prisma.masterPattern.findMany({ orderBy: { createdAt: 'desc' }, take: 3, include: { createdBy: true } }),
      ]);

      // Sesiones por día (últimos 14 días)
      const daily = Array.from({ length: 14 }, (_, i) => {
        const day = new Date(since);
        day.setDate(since.getDate() + i);
        return { date: day.toISOString().slice(0, 10), count: 0 };
      });
      for (const s of sessions) {
        const key = s.createdAt.toISOString().slice(0, 10);
        const slot = daily.find((d) => d.date === key);
        if (slot) slot.count += 1;
      }

      const byRole = { user: 0, admin: 0, master: 0, system: 0 };
      for (const u of users) byRole[{ VOCERO: 'user', ADMIN: 'admin', MASTER: 'master', SYSTEM: 'system' }[u.role] || 'user'] += 1;

      const activity = [
        ...recentUsers.map((u) => ({
          id: `u-${u.id}`,
          icon: 'users',
          text: `Se creó la cuenta de ${u.name}${u.tenant ? ` en ${u.tenant.name}` : ''}`,
          at: u.createdAt,
        })),
        ...recentSessions.map((s) => ({
          id: `s-${s.id}`,
          icon: 'mic',
          text: `${s.user.name} completó "${s.theme.title}"${s.score != null ? ` (${s.score}/100)` : ''}`,
          at: s.completedAt || s.createdAt,
        })),
        ...patterns.map((p) => ({
          id: `p-${p.id}`,
          icon: 'sliders',
          text: `${p.createdBy.name} publicó el patrón maestro v${p.version}`,
          at: p.createdAt,
        })),
      ]
        .sort((a, b) => new Date(b.at) - new Date(a.at))
        .slice(0, 8);

      res.json({
        status: 'ok',
        tenants: { total: tenants.length, active: tenants.filter((t) => t.status === 'ACTIVE').length },
        users: { total: users.length, active: users.filter((u) => u.status === 'ACTIVE').length, byRole },
        sessions: { daily, month: await prisma.session.count({ where: { createdAt: { gte: startOfMonth() } } }) },
        activity,
      });
    } catch (error) {
      console.error('Error obteniendo resumen:', error);
      fail(res, 500, 'No se pudo obtener el resumen del sistema.');
    }
  });
};
