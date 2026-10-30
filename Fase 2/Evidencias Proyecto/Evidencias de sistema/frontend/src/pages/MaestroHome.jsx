import { useI18n } from '../lib/i18n';
import Icon from '../components/Icon';
import { Badge, Button, Card, CardHeader, EmptyState, PageHeader, Stat } from '../components/ui';
import useApiData from '../hooks/useApiData';
import { formatDate } from '../data/directory';

// Panel del configurador maestro (GET /api/master/overview)
export default function MaestroHome() {
  const { d, lang } = useI18n();
  const t = d.L.m1;
  const areaLabels = t.areaLabels;
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
            {t.reviewQueue}{data?.pendingReview ? ` (${data.pendingReview})` : ''}
          </Button>
        }
      />

      {error && (
        <Card className="mb-6">
          <EmptyState tone="danger" icon="server" title={t.loadFailed} description={error} />
        </Card>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <Stat label={t.stClients} value={data?.tenants ?? '—'} icon="users" />
        <Stat label={t.stSessionsWeek} value={data?.sessionsWeek ?? '—'} icon="activity" />
        <Stat label={t.stPending} value={data?.pendingReview ?? '—'} icon="tag" hint={data ? t.stPendingHint(data.evaluated) : undefined} />
        <Stat
          label={t.stAgreement}
          value={data?.agreement != null ? `${data.agreement}%` : '—'}
          icon="target"
          hint={data?.agreement != null ? t.stAgreementHint : t.stAgreementPending}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.6fr] gap-6">
        {/* Patrón activo */}
        <Card className="flex flex-col">
          <CardHeader title={t.patternTitle} description={t.patternDesc} />
          {loading && !data ? (
            <p className="text-sm text-muted">{t.loading}</p>
          ) : pattern ? (
            <>
              <div className="flex items-baseline gap-3">
                <span className="font-display font-semibold text-[44px] leading-none tracking-[-0.03em] text-ink">v{pattern.version}</span>
                <Badge tone="success" icon="check">{t.active}</Badge>
              </div>
              <div className="text-sm font-medium text-ink mt-3">{pattern.name}</div>
              <ul className="mt-4 space-y-2.5 text-[13px] text-muted">
                <li className="flex items-center gap-2">
                  <Icon name="clock" size={14} className="text-faint" /> {formatDate(pattern.createdAt, lang)} · {pattern.createdBy?.name || '—'}
                </li>
                <li className="flex items-center gap-2">
                  <Icon name="sliders" size={14} className="text-faint" /> {t.strictness(pattern.config.strictness)}
                </li>
                <li className="flex items-center gap-2">
                  <Icon name="layers" size={14} className="text-faint" /> {t.overrides(pattern.overrides.length)}
                </li>
              </ul>
              <div className="flex flex-wrap gap-1.5 mt-4">
                {Object.entries(pattern.config.areas).map(([k, v]) => (
                  <Badge key={k} tone="outline">
                    {areaLabels[k]} {v}%
                  </Badge>
                ))}
              </div>
            </>
          ) : (
            <p className="text-sm text-muted">{t.noPattern}</p>
          )}
          <Button variant="secondary" to="/maestro/rubrica" iconRight="arrowRight" className="mt-8 w-full">
            {t.openRub}
          </Button>
        </Card>

        {/* Histograma real */}
        <Card>
          <CardHeader title={t.distL} description={data ? t.evaluatedCount(data.evaluated) : t.loading} />
          {data?.evaluated === 0 ? (
            <EmptyState icon="chart" title={t.noEvaluated} />
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
