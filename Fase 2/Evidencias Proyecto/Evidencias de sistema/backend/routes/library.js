// Biblioteca de escenarios generales (equipo de VoxReady).
// - El administrador del sistema los crea, edita y elimina.
// - No pertenecen a ninguna organización: todos los voceros los ven en "Generales",
//   y suspender una organización o anonimizar a un vocero nunca los afecta.
// - El administrador del cliente puede copiar uno a su organización para adaptarlo.
const { requireAuth } = require('../auth');
const { parseList } = require('../ai/interviewer');

const fail = (res, code, mensaje) => res.status(code).json({ status: 'error', mensaje });
const CATEGORIES = ['CRISIS', 'MEDIOS', 'INSTITUCIONAL', 'GENERAL'];

const toApiLibraryTheme = (t) => ({
  id: t.id,
  title: t.title,
  context: t.context,
  category: t.category,
  optic: t.optic,
  keyMessages: parseList(t.keyMessages),
  redLines: parseList(t.redLines),
  publics: parseList(t.publics),
  sessions: t._count?.sessions ?? 0,
  createdAt: t.createdAt,
});

// Valida y normaliza los datos de un escenario. Devuelve { error } o { data }.
function readTheme(body = {}) {
  const { title, context, category, optic, keyMessages = [], redLines = [], publics = [] } = body;
  if (!title?.trim() || !context?.trim()) return { error: 'El nombre y el contexto son obligatorios.' };
  const clean = (list) => (Array.isArray(list) ? list.map((x) => String(x).trim()).filter(Boolean) : []);
  if (!clean(keyMessages).length) return { error: 'Agrega al menos un mensaje clave.' };
  return {
    data: {
      title: title.trim(),
      context: context.trim(),
      category: CATEGORIES.includes(category) ? category : 'GENERAL',
      optic: optic || null,
      keyMessages: JSON.stringify(clean(keyMessages)),
      redLines: JSON.stringify(clean(redLines)),
      publics: JSON.stringify(clean(publics)),
    },
  };
}

module.exports = function registerLibraryRoutes(app, prisma) {
  const auth = (...roles) => requireAuth(prisma, roles);
  const active = { isGlobal: true, deletedAt: null };

  const titleTaken = (title, exceptId) =>
    prisma.theme.findFirst({ where: { ...active, title, ...(exceptId ? { NOT: { id: exceptId } } : {}) } });

  // Lista de escenarios generales (el admin del cliente la ve para copiarlos)
  app.get('/api/library/themes', auth('system', 'master', 'admin'), async (req, res) => {
    try {
      const themes = await prisma.theme.findMany({
        where: active,
        orderBy: { title: 'asc' },
        include: { _count: { select: { sessions: true } } },
      });
      res.json({ status: 'ok', themes: themes.map(toApiLibraryTheme) });
    } catch (error) {
      console.error('Error listando la biblioteca:', error);
      fail(res, 500, 'No se pudo obtener la biblioteca de escenarios.');
    }
  });

  app.post('/api/library/themes', auth('system'), async (req, res) => {
    try {
      const { error, data } = readTheme(req.body);
      if (error) return fail(res, 400, error);
      if (await titleTaken(data.title)) return fail(res, 409, 'Ya existe un escenario general con ese nombre.');
      const theme = await prisma.theme.create({ data: { ...data, isGlobal: true, tenantId: null } });
      res.status(201).json({ status: 'ok', theme: toApiLibraryTheme(theme) });
    } catch (error) {
      console.error('Error creando escenario general:', error);
      fail(res, 500, 'No se pudo crear el escenario.');
    }
  });

  app.put('/api/library/themes/:id', auth('system'), async (req, res) => {
    try {
      const theme = await prisma.theme.findUnique({ where: { id: req.params.id } });
      if (!theme?.isGlobal || theme.deletedAt) return fail(res, 404, 'Escenario general no encontrado.');
      const { error, data } = readTheme(req.body);
      if (error) return fail(res, 400, error);
      if (await titleTaken(data.title, theme.id)) return fail(res, 409, 'Ya existe un escenario general con ese nombre.');
      const updated = await prisma.theme.update({ where: { id: theme.id }, data });
      res.json({ status: 'ok', theme: toApiLibraryTheme(updated) });
    } catch (error) {
      console.error('Error actualizando escenario general:', error);
      fail(res, 500, 'No se pudo actualizar el escenario.');
    }
  });

  // Borrado lógico: deja de mostrarse, pero se conserva el historial de prácticas
  app.delete('/api/library/themes/:id', auth('system'), async (req, res) => {
    try {
      const theme = await prisma.theme.findUnique({ where: { id: req.params.id } });
      if (!theme?.isGlobal || theme.deletedAt) return fail(res, 404, 'Escenario general no encontrado.');
      await prisma.theme.update({ where: { id: theme.id }, data: { deletedAt: new Date() } });
      res.json({ status: 'ok' });
    } catch (error) {
      console.error('Error eliminando escenario general:', error);
      fail(res, 500, 'No se pudo eliminar el escenario.');
    }
  });

  // Copia un escenario general a la organización del administrador para adaptarlo
  app.post('/api/library/themes/:id/copy', auth('admin'), async (req, res) => {
    try {
      const source = await prisma.theme.findUnique({ where: { id: req.params.id } });
      if (!source?.isGlobal || source.deletedAt) return fail(res, 404, 'Escenario general no encontrado.');

      // Nombre único dentro de la organización: "Título", "Título (copia)", "Título (copia 2)"…
      const taken = new Set(
        (await prisma.theme.findMany({ where: { tenantId: req.user.tenantId }, select: { title: true } })).map((t) => t.title),
      );
      let title = source.title;
      for (let n = 1; taken.has(title); n += 1) title = `${source.title} (copia${n > 1 ? ` ${n}` : ''})`;

      const theme = await prisma.theme.create({
        data: {
          title,
          context: source.context,
          category: source.category,
          optic: source.optic,
          keyMessages: source.keyMessages,
          redLines: source.redLines,
          publics: source.publics,
          tenantId: req.user.tenantId,
          isGlobal: false,
        },
      });
      res.status(201).json({ status: 'ok', theme: { id: theme.id, title: theme.title } });
    } catch (error) {
      console.error('Error copiando escenario general:', error);
      fail(res, 500, 'No se pudo copiar el escenario.');
    }
  });
};
