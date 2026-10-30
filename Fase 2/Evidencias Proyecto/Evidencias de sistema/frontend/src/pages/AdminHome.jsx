import { Link } from 'react-router-dom';
import { useI18n } from '../lib/i18n';
import Icon from '../components/Icon';
import { Avatar, Badge, Button, Card, CardHeader, EmptyState, PageHeader, Stat, Table } from '../components/ui';
import useApiData from '../hooks/useApiData';
import { getCurrentUser } from '../lib/api';
import MetricsDashboard from '../components/MetricsDashboard';
import { formatDate, initialsOf } from '../data/directory';

// Panel del administrador del cliente (datos reales de su organización)
export default function AdminHome() {
  const { d, lang } = useI18n();
  const t = d.L.a1;
  const categories = d.L.a5.category;
  const me = getCurrentUser() || {};
  const overview = useApiData('/api/admin/overview');
  const themesData = useApiData('/api/themes');
  const practicesData = useApiData('/api/practices');
  const ov = overview.data;
  const themes = themesData.data?.themes || [];
  const practices = (practicesData.data?.practices || []).slice(0, 4);

  return (
    <>
      <PageHeader
        eyebrow={me.tenantName ? t.eyebrowWith(me.tenantName) : t.eyebrow}
        title={t.title}
        description={t.sub}
        actions={
          <>
            <Button variant="secondary" to="/admin/voceros" icon="users">
              {t.vocerosBtn}
            </Button>
            <Button to="/admin/tema" icon="plus">
              {t.newT}
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <Stat label={t.statScenarios} value={ov?.themes ?? '—'} icon="file" />
        <Stat label={t.statVoceros} value={ov?.voceros ?? '—'} icon="users" />
        <Stat label={t.statSessions} value={ov?.sessionsMonth ?? '—'} icon="activity" hint={ov ? t.statSessionsHint(ov.evaluated) : undefined} />
        <Stat label={t.statAvg} value={ov?.avgScore ?? '—'} icon="target" hint={t.statAvgHint} />
      </div>

      {/* Últimas prácticas de los voceros */}
      <div className="mb-8">
        <div className="flex items-end justify-between mb-4">
          <div>
            <h2 className="text-[15px] font-semibold text-ink">{t.latestPractices}</h2>
            <p className="text-[13px] text-muted mt-0.5">{t.fromVoceros}</p>
          </div>
          <Link to="/admin/practicas" className="text-[13px] font-medium text-muted hover:text-ink inline-flex items-center gap-1">
            {t.viewAll} <Icon name="arrowRight" size={14} />
          </Link>
        </div>
        {practices.length === 0 ? (
          <Card>
            <p className="text-sm text-muted">{practicesData.loading ? t.loading : t.noPractices}</p>
          </Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {practices.map((p) => (
              <Link key={p.id} to={`/admin/informe?sesion=${p.id}`} className="group">
                <Card className="p-5 h-full flex flex-col hover:shadow-lift hover:border-line-strong transition-all">
                  <div className="flex items-center gap-3">
                    <Avatar initials={initialsOf(p.user.name)} size="sm" />
                    <span className="flex-1 min-w-0 text-sm font-medium text-ink truncate">{p.user.name}</span>
                    <span className="text-lg font-semibold tabular-nums text-ink">{p.score}</span>
                  </div>
                  <p className="text-[13px] text-muted mt-3 line-clamp-2 flex-1">{p.theme?.title}</p>
                  <div className="flex items-center justify-between mt-4 pt-3 border-t border-line text-xs text-faint">
                    <span>{formatDate(p.completedAt, lang)}</span>
                    {p.redLinesCrossed > 0 ? (
                      <span className="inline-flex items-center gap-1 text-danger">
                        <Icon name="alert" size={12} /> {t.redLines(p.redLinesCrossed)}
                      </span>
                    ) : (
                      <Icon name="chevronRight" size={14} className="group-hover:text-ink transition-colors" />
                    )}
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>

        <Card>
          <CardHeader title={t.orgScenarios} description={t.scenarioCount(themes.length)} />
          {themesData.loading && !themesData.data ? (
            <EmptyState icon="refresh" title={t.loading} />
          ) : themes.length === 0 ? (
            <EmptyState icon="file" title={t.noScenarios} action={<Button to="/admin/tema" icon="plus">{t.createFirst}</Button>} />
          ) : (
            <Table columns={[{ label: t.thScenario }, { label: t.thType }, { label: t.thAssigned }, { label: t.thSessions }, { label: '', align: 'right' }]}>
              {themes.map((th) => (
                <tr key={th.id} className="hover:bg-subtle/50 transition-colors">
                  <td className="py-3.5 px-6">
                    <div className="flex items-center gap-3 min-w-[200px]">
                      <span className="h-9 w-9 rounded-lg bg-subtle flex items-center justify-center text-muted shrink-0">
                        <Icon name="file" size={16} />
                      </span>
                      <span className="font-medium text-ink">{th.title}</span>
                    </div>
                  </td>
                  <td className="py-3.5 px-6">
                    <Badge tone="outline">{categories[th.category] || th.category}</Badge>
                  </td>
                  <td className="py-3.5 px-6 text-muted whitespace-nowrap">
                    {th.availableToAllVoceros ? t.allVoceros : t.voceroCount(th.voceroIds.length)}
                  </td>
                  <td className="py-3.5 px-6 text-muted tabular-nums">{th.sessions}</td>
                  <td className="py-3.5 px-6 text-right">
                    <Button variant="ghost" size="sm" to={`/admin/tema?id=${th.id}`} iconRight="chevronRight">
                      {t.edit}
                    </Button>
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>

      {/* Métricas de la organización */}
      <MetricsDashboard />
    </>
  );
}
