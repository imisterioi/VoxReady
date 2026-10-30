import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { checkEndpoint } from '../../lib/api';
import { useI18n } from '../../lib/i18n';
import { roleMeta, timeAgo } from '../../data/directory';
import useApiData from '../../hooks/useApiData';
import MetricsDashboard from '../../components/MetricsDashboard';
import JobsPanel from '../../components/JobsPanel';
import Icon from '../../components/Icon';
import { Badge, Button, Card, CardHeader, PageHeader, Stat, cx } from '../../components/ui';

const ROLE_COLORS = { user: 'bg-[rgb(var(--c4))]', admin: 'bg-accent', master: 'bg-success', system: 'bg-brand' };

// El estado solo aporta el tono y el punto de color: la etiqueta visible sale del diccionario.
const SERVICE_STATE = {
  loading: { key: 'stateLoading', dot: 'bg-faint animate-pulse' },
  ok: { key: 'stateOk', dot: 'bg-success' },
  error: { key: 'stateError', dot: 'bg-danger' },
  offline: { key: 'stateOffline', dot: 'bg-danger' },
  client: { key: 'stateClient', dot: 'bg-success' },
  idle: { key: 'stateIdle', dot: 'bg-faint' },
  running: { key: 'stateRunning', dot: 'bg-success animate-pulse' },
  pending: { key: 'statePending', dot: 'bg-faint' },
};

export default function SistemaHome() {
  const { d } = useI18n();
  const t = d.L.sys.home;
  const roles = roleMeta(d);
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
  const aiDetail = (p) => (p.lastModel ? t.aiDetail(p.lastModel, p.failures, p.calls) : null);
  const jobDetail = (p) => (p.lastError ? p.lastError.message : p.lastRunAt ? t.jobDetailLastRun(timeAgo(p.lastRunAt, d)) : null);

  const services = [
    { name: t.svcApi, detail: t.svcApiDetail, icon: 'server', ...api },
    { name: t.svcDb, detail: t.svcDbDetail, icon: 'database', ...db },
    {
      name: t.svcStorage,
      detail: t.svcStoragePath,
      icon: 'video',
      ...fromBackend('storage', (p) => t.svcStorageDetail(p.recordings, p.megabytes)),
    },
    { name: t.svcInterviewer, detail: t.svcInterviewerDetail, icon: 'mic', ...fromBackend('interviewer', null) },
    { name: t.svcEvaluator, detail: t.svcEvaluatorDetail, icon: 'sparkles', ...fromBackend('evaluator', aiDetail) },
    { name: t.svcRetention, detail: t.svcRetentionDetail, icon: 'clock', ...fromBackend('job-retention', jobDetail) },
    { name: t.svcDeletion, detail: t.svcDeletionDetail, icon: 'trash', ...fromBackend('job-tenant-deletion', jobDetail) },
    { name: t.svcPose, detail: t.svcPoseDetail, icon: 'person', state: 'client' },
    { name: t.svcSpeech, detail: t.svcSpeechDetail, icon: 'mic', state: 'client' },
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
        eyebrow={t.eyebrow}
        title={t.title}
        description={t.sub}
        actions={
          <>
            <Button variant="secondary" icon="book" to="/sistema/biblioteca?nuevo=1">
              {t.newScenario}
            </Button>
            <Button variant="secondary" icon="layers" to="/sistema/organizaciones?nueva=1">
              {t.newOrg}
            </Button>
            <Button icon="plus" to="/sistema/usuarios?nuevo=1">
              {t.newUser}
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
              ? t.bannerChecking
              : operational === services.length
                ? t.bannerAllOk
                : t.bannerAttention}
          </div>
          <div className="text-xs text-muted mt-0.5">
            {t.bannerCount(operational, services.length)}
          </div>
        </div>
        <Button variant="ghost" size="sm" icon="refresh" onClick={runChecks} disabled={checking}>
          {t.recheck}
        </Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <Stat label={t.stActiveOrgs} value={ov ? ov.tenants.active : '—'} icon="layers" hint={ov ? t.stTotalOrgs(ov.tenants.total) : t.loading} />
        <Stat label={t.stActiveUsers} value={ov ? ov.users.active : '—'} icon="users" hint={ov ? t.stSuspended(suspended) : t.loading} />
        <Stat label={t.stSessionsMonth} value={ov ? sessionsMonth : '—'} icon="activity" hint={t.stAllOrgs} />
        <Stat
          label={t.stSessionsWeek}
          value={ov ? weekTotal : '—'}
          icon="chart"
          trend={weekDelta != null ? `${weekDelta >= 0 ? '+' : ''}${weekDelta}%` : undefined}
          hint={t.stVsPrevWeek}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1.25fr_1fr] gap-6 mb-6">
        {/* Servicios */}
        <Card padded={false}>
          <div className="p-6 pb-0">
            <CardHeader
              title={t.svcTitle}
              description={t.svcSub}
              action={
                <Link to="/laboratorio" className="text-[13px] font-medium text-muted hover:text-ink inline-flex items-center gap-1">
                  {t.diagnostics} <Icon name="arrowRight" size={14} />
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
                    {t[ui.key]}
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>

        {/* Usuarios por rol */}
        <Card className="flex flex-col">
          <CardHeader
            title={t.byRoleTitle}
            description={t.byRoleSub(usersTotal)}
            action={
              <Link to="/sistema/usuarios" className="text-[13px] font-medium text-muted hover:text-ink inline-flex items-center gap-1">
                {t.viewAll} <Icon name="arrowRight" size={14} />
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
                <span className="flex-1 text-muted">{roles[r.role].label}</span>
                <span className="font-semibold text-ink tabular-nums">{r.count}</span>
              </li>
            ))}
          </ul>
          <div className="mt-auto pt-6">
            <div className="flex items-center justify-between rounded-xl bg-subtle/60 px-4 py-3 text-[13px]">
              <span className="text-muted">{t.suspendedAccounts}</span>
              <Badge tone={suspended ? 'danger' : 'neutral'}>{suspended}</Badge>
            </div>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1.25fr_1fr] gap-6 mb-6">
        {/* Uso */}
        <Card>
          <CardHeader title={t.usageTitle} description={t.usageSub} />
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
            <span>{t.days14}</span>
            <span className="inline-flex items-center gap-3">
              <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-line-strong" /> {t.prevWeek}</span>
              <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-brand/80" /> {t.thisWeek}</span>
            </span>
            <span>{t.today}</span>
          </div>
        </Card>

        {/* Actividad */}
        <Card>
          <CardHeader title={t.activityTitle} />
          {activity.length === 0 && <p className="text-[13px] text-muted">{overview.loading ? t.loading : t.noActivity}</p>}
          <ul className="space-y-4">
            {activity.slice(0, 6).map((a) => (
              <li key={a.id} className="flex gap-3">
                <span className="h-8 w-8 rounded-lg bg-subtle text-muted flex items-center justify-center shrink-0">
                  <Icon name={a.icon} size={14} />
                </span>
                <div className="min-w-0">
                  <p className="text-[13px] text-ink leading-snug">{a.text}</p>
                  <p className="text-xs text-faint mt-0.5">{timeAgo(a.at, d)}</p>
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
            title={t.orgsTitle}
            description={t.orgsSub}
            action={
              <Link to="/sistema/organizaciones" className="text-[13px] font-medium text-muted hover:text-ink inline-flex items-center gap-1">
                {t.manage} <Icon name="arrowRight" size={14} />
              </Link>
            }
          />
        </div>
        <ul className="divide-y divide-line border-t border-line">
          {tenants.map((tn) => {
            const voceros = tn.voceros;
            const max = Math.max(...tenants.map((x) => x.sessionsMonth || 0), 1);
            return (
              <li key={tn.id} className="grid grid-cols-[1fr_auto] sm:grid-cols-[1.2fr_80px_1fr_auto] items-center gap-4 px-6 py-3.5">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-ink truncate">{tn.name}</div>
                  <div className="text-xs text-faint">{tn.sector ? d.L.dir.sectorLabels[tn.sector] || tn.sector : ''}</div>
                </div>
                <div className="hidden sm:block text-xs text-muted tabular-nums">{t.vocerosCount(voceros)}</div>
                <div className="hidden sm:flex items-center gap-3">
                  <div className="flex-1 h-1.5 rounded-full bg-subtle overflow-hidden">
                    <div className="h-full rounded-full bg-brand/70" style={{ width: `${((tn.sessionsMonth || 0) / max) * 100}%` }} />
                  </div>
                  <span className="w-10 text-right text-xs text-ink tabular-nums">{tn.sessionsMonth || 0}</span>
                </div>
                <Badge tone={tn.status === 'ACTIVE' ? 'success' : 'danger'}>{tn.status === 'ACTIVE' ? t.active : t.suspended}</Badge>
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
