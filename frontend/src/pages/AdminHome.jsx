import { Link } from 'react-router-dom';
import I from '../data/dictionary';
import Icon from '../components/Icon';
import { Avatar, Badge, Button, Card, CardHeader, EmptyState, PageHeader, Stat, Table } from '../components/ui';
import useApiData from '../hooks/useApiData';
import { getCurrentUser } from '../lib/api';
import { formatDate, initialsOf } from '../data/directory';

const CATEGORY = { CRISIS: 'Crisis', MEDIOS: 'Medios', INSTITUCIONAL: 'Institucional', GENERAL: 'General' };

// Panel del administrador del cliente (datos reales de su organización)
export default function AdminHome() {
  const t = I.es.L.a1;
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
        eyebrow={me.tenantName ? `Administración · ${me.tenantName}` : t.eyebrow}
        title={t.title}
        description={t.sub}
        actions={
          <>
            <Button variant="secondary" to="/admin/voceros" icon="users">
              Voceros
            </Button>
            <Button to="/admin/tema" icon="plus">
              {t.newT}
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <Stat label="Escenarios" value={ov?.themes ?? '—'} icon="file" />
        <Stat label="Voceros activos" value={ov?.voceros ?? '—'} icon="users" />
        <Stat label="Sesiones del mes" value={ov?.sessionsMonth ?? '—'} icon="activity" hint={ov ? `${ov.evaluated} evaluadas en total` : undefined} />
        <Stat label="Puntaje promedio" value={ov?.avgScore ?? '—'} icon="target" hint="De todas las prácticas evaluadas" />
      </div>

      {/* Últimas prácticas de los voceros */}
      <div className="mb-8">
        <div className="flex items-end justify-between mb-4">
          <div>
            <h2 className="text-[15px] font-semibold text-ink">Últimas prácticas</h2>
            <p className="text-[13px] text-muted mt-0.5">De tus voceros</p>
          </div>
          <Link to="/admin/practicas" className="text-[13px] font-medium text-muted hover:text-ink inline-flex items-center gap-1">
            Ver todas <Icon name="arrowRight" size={14} />
          </Link>
        </div>
        {practices.length === 0 ? (
          <Card>
            <p className="text-sm text-muted">{practicesData.loading ? 'Cargando…' : 'Aún no hay prácticas evaluadas.'}</p>
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
                    <span>{formatDate(p.completedAt)}</span>
                    {p.redLinesCrossed > 0 ? (
                      <span className="inline-flex items-center gap-1 text-danger">
                        <Icon name="alert" size={12} /> {p.redLinesCrossed} línea(s) roja(s)
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
          <CardHeader title="Escenarios de la organización" description={`${themes.length} escenario(s)`} />
          {themesData.loading && !themesData.data ? (
            <EmptyState icon="refresh" title="Cargando…" />
          ) : themes.length === 0 ? (
            <EmptyState icon="file" title="Aún no hay escenarios" action={<Button to="/admin/tema" icon="plus">Crear el primero</Button>} />
          ) : (
            <Table columns={[{ label: 'Escenario' }, { label: 'Tipo' }, { label: 'Asignado a' }, { label: 'Sesiones' }, { label: '', align: 'right' }]}>
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
                    <Badge tone="outline">{CATEGORY[th.category] || th.category}</Badge>
                  </td>
                  <td className="py-3.5 px-6 text-muted whitespace-nowrap">
                    {th.availableToAllVoceros ? 'Todos los voceros' : `${th.voceroIds.length} vocero(s)`}
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
    </>
  );
}
