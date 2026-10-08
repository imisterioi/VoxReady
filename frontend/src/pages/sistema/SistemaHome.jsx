import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { checkEndpoint } from '../../lib/api';
import { ROLE_META, timeAgo } from '../../data/directory';
import useApiData from '../../hooks/useApiData';
import MetricsDashboard from '../../components/MetricsDashboard';
import JobsPanel from '../../components/JobsPanel';
import Icon from '../../components/Icon';
import { Badge, Button, Card, CardHeader, PageHeader, Stat, cx } from '../../components/ui';

const ROLE_COLORS = { user: 'bg-[rgb(var(--c4))]', admin: 'bg-accent', master: 'bg-success', system: 'bg-brand' };

const SERVICE_STATE = {
  loading: { label: 'Comprobando…', tone: 'neutral', dot: 'bg-faint animate-pulse' },
  ok: { label: 'Operativo', tone: 'success', dot: 'bg-success' },
  error: { label: 'Con errores', tone: 'danger', dot: 'bg-danger' },
  offline: { label: 'Sin conexión', tone: 'danger', dot: 'bg-danger' },
  client: { label: 'En navegador', tone: 'success', dot: 'bg-success' },
  idle: { label: 'Sin actividad aún', tone: 'neutral', dot: 'bg-faint' },
  running: { label: 'En ejecución', tone: 'success', dot: 'bg-success animate-pulse' },
  pending: { label: 'No conectado', tone: 'neutral', dot: 'bg-faint' },
};

export default function SistemaHome() {
  // Datos reales: GET /api/system/overview y GET /api/tenants
  const overview = useApiData('/api/system/overview');
  const tenantsData = useApiData('/api/tenants');
  const tenants = tenantsData.data?.tenants || [];
  const ov = overview.data;
  const activity = ov?.activity || [];
  const DAILY_SESSIONS = ov?.sessions.daily.map((d) => d.count) || Array(14).fill(0);
  const [api, setApi] = useState({ state: 'loading' });
  const [db, setDb] = useState({ state: 'loading' });
  const status = useApiData('/api/system/status');
  const reloadStatus = status.reload;

  const runChecks = useCallback(async () => {
    setApi({ state: 'loading' });
    setDb({ state: 'loading' });
    reloadStatus();
    const [a, d] = await Promise.all([checkEndpoint('/api/health'), checkEndpoint('/api/db-test')]);
    setApi(a);
    // Si la API no responde, la base de datos tampoco se puede comprobar
    setDb(a.state === 'offline' ? { state: 'offline' } : d);
  }, [reloadStatus]);

  useEffect(() => {
    runChecks();
  }, [runChecks]);

  // Estado real de cada proceso crítico (GET /api/system/status). Si la API no responde,
  // los procesos que dependen de ella se muestran con el estado de la API.
  const processes = Object.fromEntries((status.data?.processes || []).map((p) => [p.key, p]));
  const fromBackend = (key, describe) => {
    const p = processes[key];
    if (!p) return { state: api.state === 'ok' ? 'loading' : api.state };
    return { state: p.state === 'pending' ? 'idle' : p.state, ms: p.ms ?? p.lastMs, extra: p.detail || describe?.(p) };
  };
  const aiDetail = (p) => (p.lastModel ? `Último modelo: ${p.lastModel} · ${p.failures} fallo(s) de ${p.calls} consulta(s)` : null);
  const jobDetail = (p) => (p.lastError ? p.lastError.message : p.lastRunAt ? `Última ejecución ${timeAgo(p.lastRunAt)}` : null);

  const services = [
    { name: 'API VoxReady', detail: 'Express · /api/health', icon: 'server', ...api },
    { name: 'Base de datos', detail: 'PostgreSQL · Prisma', icon: 'database', ...db },
    {
      name: 'Almacenamiento de grabaciones',
      detail: 'backend/uploads',
      icon: 'video',
      ...fromBackend('storage', (p) => `${p.recordings} grabación(es) · ${p.megabytes} MB`),
    },
    { name: 'IA entrevistadora', detail: 'API de NVIDIA', icon: 'sparkles', ...fromBackend('interviewer', aiDetail) },
    { name: 'IA evaluadora', detail: 'API de NVIDIA', icon: 'sparkles', ...fromBackend('evaluator', aiDetail) },
    { name: 'Retención de datos', detail: 'Borrado automático por vencimiento', icon: 'clock', ...fromBackend('job-retention', jobDetail) },
    { name: 'Eliminación de organizaciones', detail: 'Proceso reintentable', icon: 'trash', ...fromBackend('job-tenant-deletion', jobDetail) },
    { name: 'Análisis de pose y rostro', detail: 'MediaPipe · se ejecuta en el navegador', icon: 'person', state: 'client' },
    { name: 'Transcripción de voz', detail: 'Reconocimiento de voz del navegador (Chrome/Edge)', icon: 'mic', state: 'client' },
  ];
  // Un proceso sin actividad todavía (por ejemplo, la IA evaluadora antes de la primera práctica) no está caído
  const operational = services.filter((s) => ['ok', 'client', 'idle', 'running'].includes(s.state)).length;
  const checking = api.state === 'loading';

  const usersTotal = ov?.users.total || 0;
  const suspended = usersTotal - (ov?.users.active || 0);
  const sessionsMonth = ov?.sessions.month || 0;

  const byRole = ['user', 'admin', 'master', 'system'].map((role) => ({
    role,
    count: ov?.users.byRole[role] || 0,
  }));

  const maxDaily = Math.max(1, ...DAILY_SESSIONS);
  const weekTotal = DAILY_SESSIONS.slice(-7).reduce((a, b) => a + b, 0);
  const prevWeek = DAILY_SESSIONS.slice(0, 7).reduce((a, b) => a + b, 0);
  const weekDelta = prevWeek ? Math.round(((weekTotal - prevWeek) / prevWeek) * 100) : null;

  return (
    <>
      <PageHeader
        eyebrow="Administración del sistema"
        title="Estado del sistema"
        description="Visión general de la plataforma: servicios, organizaciones, usuarios y uso."
        actions={
          <>
            <Button variant="secondary" icon="book" to="/sistema/biblioteca?nuevo=1">
              Nuevo escenario general
            </Button>
            <Button variant="secondary" icon="layers" to="/sistema/organizaciones?nueva=1">
              Nueva organización
            </Button>
            <Button icon="plus" to="/sistema/usuarios?nuevo=1">
              Nuevo usuario
            </Button>
          </>
        }
      />

      {/* Banner de salud general */}
      <div
        className={cx(
          'flex flex-col sm:flex-row sm:items-center gap-3 rounded-2xl border px-5 py-4 mb-6',
          checking ? 'border-line bg-surface' : operational === services.length ? 'border-success/25 bg-success/[0.06]' : 'border-danger/25 bg-danger/[0.05]',
        )}
      >
        <span
          className={cx(
            'h-9 w-9 rounded-xl flex items-center justify-center',
            checking ? 'bg-subtle text-muted' : operational === services.length ? 'bg-success/15 text-success' : 'bg-danger/10 text-danger',
          )}
        >
          <Icon name={checking ? 'refresh' : operational === services.length ? 'check' : 'alert'} size={17} strokeWidth={2} />
        </span>
        <div className="flex-1">
          <div className="text-sm font-medium text-ink">
            {checking
              ? 'Comprobando servicios…'
              : operational === services.length
                ? 'Todos los servicios conectados funcionan con normalidad'
                : 'Hay servicios que requieren atención'}
          </div>
          <div className="text-xs text-muted mt-0.5">
            {operational} de {services.length} servicios operativos
          </div>
        </div>
        <Button variant="ghost" size="sm" icon="refresh" onClick={runChecks} disabled={checking}>
          Volver a comprobar
        </Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <Stat label="Organizaciones activas" value={ov ? ov.tenants.active : '—'} icon="layers" hint={ov ? `${ov.tenants.total} en total` : 'Cargando…'} />
        <Stat label="Usuarios activos" value={ov ? ov.users.active : '—'} icon="users" hint={ov ? `${suspended} suspendidos` : 'Cargando…'} />
        <Stat label="Sesiones del mes" value={ov ? sessionsMonth : '—'} icon="activity" hint="Todas las organizaciones" />
        <Stat
          label="Sesiones esta semana"
          value={ov ? weekTotal : '—'}
          icon="chart"
          trend={weekDelta != null ? `${weekDelta >= 0 ? '+' : ''}${weekDelta}%` : undefined}
          hint="vs. semana anterior"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1.25fr_1fr] gap-6 mb-6">
        {/* Servicios */}
        <Card padded={false}>
          <div className="p-6 pb-0">
            <CardHeader
              title="Servicios"
              description="Consultados en vivo contra el backend"
              action={
                <Link to="/laboratorio" className="text-[13px] font-medium text-muted hover:text-ink inline-flex items-center gap-1">
                  Diagnóstico <Icon name="arrowRight" size={14} />
                </Link>
              }
            />
          </div>
          <ul className="divide-y divide-line border-t border-line">
            {services.map((s) => {
              const ui = SERVICE_STATE[s.state] || SERVICE_STATE.error;
              return (
                <li key={s.name} className="flex items-center gap-4 px-6 py-3.5">
                  <span className="h-9 w-9 rounded-lg bg-subtle text-muted flex items-center justify-center">
                    <Icon name={s.icon} size={16} />
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-ink">{s.name}</div>
                    <div className="text-xs text-faint truncate">
                      {s.detail}
                      {s.extra ? ` · ${s.extra}` : ''}
                    </div>
                  </div>
                  {s.ms != null && s.state === 'ok' && <span className="hidden sm:inline text-xs text-faint font-mono">{s.ms} ms</span>}
                  <span className="inline-flex items-center gap-1.5 text-xs text-muted whitespace-nowrap">
                    <span className={cx('h-2 w-2 rounded-full', ui.dot)} />
                    {ui.label}
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>

        {/* Usuarios por rol */}
        <Card className="flex flex-col">
          <CardHeader
            title="Usuarios por rol"
            description={`${usersTotal} cuentas registradas`}
            action={
              <Link to="/sistema/usuarios" className="text-[13px] font-medium text-muted hover:text-ink inline-flex items-center gap-1">
                Ver todos <Icon name="arrowRight" size={14} />
              </Link>
            }
          />
          <div className="flex h-2.5 rounded-full overflow-hidden gap-0.5 mb-6">
            {byRole.map((r) => (
              <div key={r.role} className={ROLE_COLORS[r.role]} style={{ width: `${(r.count / Math.max(usersTotal, 1)) * 100}%` }} />
            ))}
          </div>
          <ul className="space-y-3">
            {byRole.map((r) => (
              <li key={r.role} className="flex items-center gap-3 text-sm">
                <span className={cx('h-2.5 w-2.5 rounded-sm', ROLE_COLORS[r.role])} />
                <span className="flex-1 text-muted">{ROLE_META[r.role].label}</span>
                <span className="font-semibold text-ink tabular-nums">{r.count}</span>
              </li>
            ))}
          </ul>
          <div className="mt-auto pt-6">
            <div className="flex items-center justify-between rounded-xl bg-subtle/60 px-4 py-3 text-[13px]">
              <span className="text-muted">Cuentas suspendidas</span>
              <Badge tone={suspended ? 'danger' : 'neutral'}>{suspended}</Badge>
            </div>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1.25fr_1fr] gap-6 mb-6">
        {/* Uso */}
        <Card>
          <CardHeader title="Sesiones de práctica" description="Últimos 14 días, todas las organizaciones" />
          <div className="flex items-end gap-1.5 h-40">
            {DAILY_SESSIONS.map((v, i) => (
              <div key={i} className="group relative flex-1 h-full flex items-end">
                <div
                  className={cx('w-full rounded-t-md transition-colors', i >= 7 ? 'bg-brand/80 group-hover:bg-accent' : 'bg-line-strong group-hover:bg-accent/60')}
                  style={{ height: `${(v / maxDaily) * 100}%` }}
                />
                <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-[11px] text-muted tabular-nums opacity-0 group-hover:opacity-100 transition-opacity">
                  {v}
                </span>
              </div>
            ))}
          </div>
          <div className="flex justify-between text-[11px] text-faint mt-2 pt-2 border-t border-line">
            <span>Hace 14 días</span>
            <span className="inline-flex items-center gap-3">
              <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-line-strong" /> Semana anterior</span>
              <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-brand/80" /> Esta semana</span>
            </span>
            <span>Hoy</span>
          </div>
        </Card>

        {/* Actividad */}
        <Card>
          <CardHeader title="Actividad reciente" />
          {activity.length === 0 && <p className="text-[13px] text-muted">{overview.loading ? 'Cargando…' : 'Aún no hay actividad.'}</p>}
          <ul className="space-y-4">
            {activity.slice(0, 6).map((a) => (
              <li key={a.id} className="flex gap-3">
                <span className="h-8 w-8 rounded-lg bg-subtle text-muted flex items-center justify-center shrink-0">
                  <Icon name={a.icon} size={14} />
                </span>
                <div className="min-w-0">
                  <p className="text-[13px] text-ink leading-snug">{a.text}</p>
                  <p className="text-xs text-faint mt-0.5">{timeAgo(a.at)}</p>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {/* Organizaciones */}
      <Card padded={false}>
        <div className="p-6 pb-0">
          <CardHeader
            title="Organizaciones"
            description="Uso por cliente este mes"
            action={
              <Link to="/sistema/organizaciones" className="text-[13px] font-medium text-muted hover:text-ink inline-flex items-center gap-1">
                Gestionar <Icon name="arrowRight" size={14} />
              </Link>
            }
          />
        </div>
        <ul className="divide-y divide-line border-t border-line">
          {tenants.map((t) => {
            const voceros = t.voceros;
            const max = Math.max(...tenants.map((x) => x.sessionsMonth || 0), 1);
            return (
              <li key={t.id} className="grid grid-cols-[1fr_auto] sm:grid-cols-[1.2fr_80px_1fr_auto] items-center gap-4 px-6 py-3.5">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-ink truncate">{t.name}</div>
                  <div className="text-xs text-faint">{t.sector}</div>
                </div>
                <div className="hidden sm:block text-xs text-muted tabular-nums">{voceros} voceros</div>
                <div className="hidden sm:flex items-center gap-3">
                  <div className="flex-1 h-1.5 rounded-full bg-subtle overflow-hidden">
                    <div className="h-full rounded-full bg-brand/70" style={{ width: `${((t.sessionsMonth || 0) / max) * 100}%` }} />
                  </div>
                  <span className="w-10 text-right text-xs text-ink tabular-nums">{t.sessionsMonth || 0}</span>
                </div>
                <Badge tone={t.status === 'ACTIVE' ? 'success' : 'danger'}>{t.status === 'ACTIVE' ? 'Activa' : 'Suspendida'}</Badge>
              </li>
            );
          })}
        </ul>
      </Card>

      {/* Jobs de borrado y anonimización, por organización */}
      <div className="mt-6">
        <JobsPanel />
      </div>

      {/* Métricas administrativas */}
      <MetricsDashboard />
    </>
  );
}
