import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '../lib/i18n';
import Icon from '../components/Icon';
import { Badge, Button, Card, EmptyState, PageHeader, cx } from '../components/ui';
import useApiData from '../hooks/useApiData';
import { formatDate } from '../data/directory';

// Cola de etiquetado (configurador maestro y administrador del sistema).
//
// Flujo en dos pasos: 1) tarjetas de TENANTS → 2) informes de ese tenant. Al pulsar un informe se
// abre el MISMO informe que ve el vocero (ruta /maestro/revision) con los elementos editables, así
// la persona que revisa ve exactamente dónde quedará cada cosa.
//
// Dentro de cada tenant: primero los pendientes de revisar (del más antiguo al más nuevo) y después
// los revisados (también del más antiguo al más nuevo); los revisados se ven más apagados. El orden de
// las tarjetas de tenants no cambia.

// Recuadro del puntaje: verde suave ≥ 80, rojo suave ≤ 20, neutro en el resto.
const scoreTone = (value) =>
  value == null
    ? 'border-line bg-surface text-muted'
    : value >= 80
      ? 'border-success/40 bg-success/10 text-success'
      : value <= 20
        ? 'border-danger/40 bg-danger/10 text-danger'
        : 'border-line bg-surface text-ink';

function ScoreBadge({ value, size = 'md' }) {
  return (
    <span
      className={cx(
        'inline-flex items-center justify-center rounded-lg border font-semibold tabular-nums',
        size === 'lg' ? 'h-14 w-14 text-xl' : 'h-10 w-10 text-sm',
        scoreTone(value),
      )}
    >
      {value ?? '—'}
    </span>
  );
}

// ------------------------------------------------------------------ 1) Tenants

function TenantList({ tenants, loading, onPick, t }) {
  if (loading) {
    return (
      <Card>
        <EmptyState icon="refresh" title={t.loading} />
      </Card>
    );
  }
  if (!tenants.length) {
    return (
      <Card>
        <EmptyState icon="tag" title={t.empty} description={t.emptyDesc} />
      </Card>
    );
  }
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {tenants.map((tenant) => {
        const pending = tenant.reports.filter((report) => !report.review).length;
        return (
          <button key={tenant.id || tenant.name} type="button" onClick={() => onPick(tenant)} className="text-left group">
            <Card className="h-full flex flex-col gap-3 hover:border-line-strong hover:shadow-lift transition-all">
              <div className="flex items-start justify-between gap-3">
                <span className="h-10 w-10 rounded-xl bg-subtle text-ink flex items-center justify-center shrink-0">
                  <Icon name="layers" size={18} />
                </span>
                <Badge tone={pending ? 'warning' : 'neutral'}>{t.pendingBadge(pending)}</Badge>
              </div>
              <div>
                <div className="text-[15px] font-semibold text-ink">{tenant.name || t.noTenant}</div>
                <div className="text-xs text-muted mt-1">{t.reportsCount(tenant.reports.length)}</div>
              </div>
              <div className="mt-auto flex items-center gap-1 text-xs text-accent-fg font-medium">
                {t.open}
                <Icon name="arrowRight" size={13} />
              </div>
            </Card>
          </button>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------ 2) Informes

function TenantReports({ tenant, onBack, onPick, t, lang }) {
  return (
    <>
      <Button variant="ghost" size="sm" icon="arrowLeft" onClick={onBack} className="-ml-3 mb-6">
        {t.backToTenants}
      </Button>
      <PageHeader eyebrow={t.eyebrow} title={tenant.name || t.noTenant} description={t.tenantSub(tenant.reports.length)} />

      <div className="space-y-2">
        {tenant.reports.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onPick(item)}
            className={cx(
              'w-full text-left rounded-xl border bg-surface p-4 transition-all flex items-center gap-4',
              item.review ? 'border-line opacity-60 hover:opacity-80' : 'border-line hover:border-line-strong hover:shadow-soft',
            )}
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-sm">
                <span className="font-medium text-ink truncate">{item.user?.name}</span>
                <span className="text-faint">–</span>
                <span className={cx('truncate', item.review ? 'text-faint' : 'text-muted')}>{item.theme?.title}</span>
              </div>
              <div className="flex flex-wrap items-center gap-2 mt-2">
                {item.review ? (
                  <Badge tone="brand" icon="check">
                    {t.reviewed}
                  </Badge>
                ) : (
                  <Badge tone={item.reason.tone}>{item.reason.label}</Badge>
                )}
                {item.pendingDraft && !item.review && <Badge tone="accent">{t.draftSaved}</Badge>}
                <span className="text-xs text-faint">{formatDate(item.completedAt || item.createdAt, lang)}</span>
              </div>
            </div>
            <ScoreBadge value={item.review ? item.review.global ?? item.score : item.score} />
          </button>
        ))}
      </div>
    </>
  );
}

// ------------------------------------------------------------------ Página

export default function ColaEtiquetado() {
  const { d, lang } = useI18n();
  const t = d.L.m3;
  const navigate = useNavigate();
  const queue = useApiData('/api/review-queue');
  const tenants = useMemo(() => queue.data?.tenants || [], [queue.data]);
  const [tenant, setTenant] = useState(null);

  // El tenant abierto se relee de la cola: así el orden y los estados siguen vigentes al volver.
  const currentTenant = tenant ? tenants.find((x) => (x.id || x.name) === (tenant.id || tenant.name)) || tenant : null;

  // Abrir un informe lleva a la MISMA vista que tiene el vocero, en modo revisión (editable).
  const openReport = (item) => navigate(`/maestro/revision?sesion=${item.id}`);

  if (currentTenant) {
    return <TenantReports tenant={currentTenant} t={t} lang={lang} onBack={() => setTenant(null)} onPick={openReport} />;
  }

  return (
    <>
      <PageHeader
        eyebrow={t.eyebrow}
        title={t.title}
        description={t.sub}
        actions={<Badge>{t.pending(queue.data?.pending ?? 0)}</Badge>}
      />
      <TenantList tenants={tenants} loading={queue.loading && !queue.data} onPick={setTenant} t={t} />
    </>
  );
}

