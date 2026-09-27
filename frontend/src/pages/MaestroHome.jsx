import I from '../data/dictionary';
import Icon from '../components/Icon';
import { Badge, Button, Card, CardHeader, EmptyState, PageHeader, Stat } from '../components/ui';
import useApiData from '../hooks/useApiData';
import { formatDate } from '../data/directory';

const AREA_LABEL = { expression: 'Expresión', voice: 'Tono de voz', coherence: 'Coherencia', empathy: 'Empatía' };

// Panel del configurador maestro (GET /api/master/overview)
export default function MaestroHome() {
  const t = I.es.L.m1;
  const { data, loading, error } = useApiData('/api/master/overview');
  const pattern = data?.activePattern;
  const histogram = data?.histogram || [];
  const max = Math.max(1, ...histogram.map((h) => h.count));

  return (
    <>
      <PageHeader
        eyebrow={t.eyebrow}
        title={t.title}
        description={t.sub}
        actions={
          <Button to="/maestro/etiquetado" icon="tag">
            Revisar cola{data?.pendingReview ? ` (${data.pendingReview})` : ''}
          </Button>
        }
      />

      {error && (
        <Card className="mb-6">
          <EmptyState tone="danger" icon="server" title="No se pudo cargar el panel" description={error} />
        </Card>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <Stat label="Clientes activos" value={data?.tenants ?? '—'} icon="users" />
        <Stat label="Sesiones (7 días)" value={data?.sessionsWeek ?? '—'} icon="activity" />
        <Stat label="Pendientes de revisión" value={data?.pendingReview ?? '—'} icon="tag" hint={data ? `${data.evaluated} evaluadas por la IA` : undefined} />
        <Stat
          label="Acuerdo IA-humano"
          value={data?.agreement != null ? `${data.agreement}%` : '—'}
          icon="target"
          hint={data?.agreement != null ? 'Áreas con diferencia ≤ 10 pts' : 'Revisa casos para medirlo'}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.6fr] gap-6">
        {/* Patrón activo */}
        <Card className="flex flex-col">
          <CardHeader title="Patrón que usa la IA" description="Aplica a todos los escenarios sin patrón exclusivo" />
          {loading && !data ? (
            <p className="text-sm text-muted">Cargando…</p>
          ) : pattern ? (
            <>
              <div className="flex items-baseline gap-3">
                <span className="font-display font-semibold text-[44px] leading-none tracking-[-0.03em] text-ink">v{pattern.version}</span>
                <Badge tone="success" icon="check">Activo</Badge>
              </div>
              <div className="text-sm font-medium text-ink mt-3">{pattern.name}</div>
              <ul className="mt-4 space-y-2.5 text-[13px] text-muted">
                <li className="flex items-center gap-2">
                  <Icon name="clock" size={14} className="text-faint" /> {formatDate(pattern.createdAt)} · {pattern.createdBy?.name || '—'}
                </li>
                <li className="flex items-center gap-2">
                  <Icon name="sliders" size={14} className="text-faint" /> Exigencia {pattern.config.strictness}
                </li>
                <li className="flex items-center gap-2">
                  <Icon name="layers" size={14} className="text-faint" /> {pattern.overrides.length} escenario(s) con patrón exclusivo propio
                </li>
              </ul>
              <div className="flex flex-wrap gap-1.5 mt-4">
                {Object.entries(pattern.config.areas).map(([k, v]) => (
                  <Badge key={k} tone="outline">
                    {AREA_LABEL[k]} {v}%
                  </Badge>
                ))}
              </div>
            </>
          ) : (
            <p className="text-sm text-muted">No hay un patrón activo: la IA usa los valores recomendados.</p>
          )}
          <Button variant="secondary" to="/maestro/rubrica" iconRight="arrowRight" className="mt-8 w-full">
            {t.openRub}
          </Button>
        </Card>

        {/* Histograma real */}
        <Card>
          <CardHeader title={t.distL} description={data ? `${data.evaluated} práctica(s) evaluada(s)` : 'Cargando…'} />
          {data?.evaluated === 0 ? (
            <EmptyState icon="chart" title="Aún no hay prácticas evaluadas" />
          ) : (
            <>
              <div className="flex items-end gap-3 h-48">
                {histogram.map((h) => (
                  <div key={h.range} className="group flex-1 flex flex-col items-center justify-end h-full">
                    <span className="text-[11px] text-muted tabular-nums mb-1.5">{h.count || ''}</span>
                    <div
                      className="w-full rounded-t-md bg-brand/80 group-hover:bg-accent transition-colors"
                      style={{ height: `${(h.count / max) * 100}%`, minHeight: h.count ? 4 : 0 }}
                    />
                  </div>
                ))}
              </div>
              <div className="flex gap-3 mt-2 pt-2 border-t border-line">
                {histogram.map((h, i) => (
                  <span key={h.range} className="flex-1 text-center text-[11px] text-faint tabular-nums">
                    {i === 0 ? '<40' : `${h.range}s`}
                  </span>
                ))}
              </div>
            </>
          )}
        </Card>
      </div>
    </>
  );
}
