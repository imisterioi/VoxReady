import { useState } from 'react';
import { useI18n } from '../lib/i18n';
import { Avatar, Badge, Card, CardHeader, EmptyState, Segmented, Stat } from './ui';
import useApiData from '../hooks/useApiData';
import { getCurrentUser } from '../lib/api';
import { initialsOf } from '../data/directory';

// Dashboard de métricas administrativas. Consume /api/metrics/overview, que resuelve
// el alcance en el backend a partir del rol (y, para MASTER/SYSTEM, de la organización
// seleccionada). Todo el texto visible usa lenguaje de negocio (sin campos técnicos).

function PeriodPicker({ value, onChange, options }) {
  return <Segmented options={options} value={value} onChange={onChange} />;
}

function RankingList({ title, rows, tone, t }) {
  return (
    <div>
      <div className="text-[13px] font-medium text-muted mb-3">{title}</div>
      {rows.length === 0 ? (
        <p className="text-[13px] text-faint">{t.noData}</p>
      ) : (
        <ul className="space-y-2.5">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center gap-3">
              <Avatar initials={initialsOf(r.name)} size="sm" />
              <span className="flex-1 min-w-0 text-sm text-ink truncate">{r.name}</span>
              <Badge tone={tone}>{t.trainings(r.sessions)}</Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ThemeList({ title, rows, tone, t }) {
  return (
    <div>
      <div className="text-[13px] font-medium text-muted mb-3">{title}</div>
      {rows.length === 0 ? (
        <p className="text-[13px] text-faint">{t.noData}</p>
      ) : (
        <ul className="space-y-2.5">
          {rows.map((th) => (
            <li key={th.id} className="flex items-center gap-3">
              <span className="flex-1 min-w-0 text-sm text-ink truncate">{th.title}</span>
              <Badge tone={tone}>{t.trainings(th.sessions)}</Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Dashboard de métricas. Solo el Administrador del Sistema (SYSTEM) tiene visión
// global y puede cambiar de organización. El ADMIN ve únicamente su organización.
export default function MetricsDashboard() {
  const { d } = useI18n();
  const t = d.L.m4;
  const me = getCurrentUser() || {};
  const isSystem = me.role === 'system';

  const [period, setPeriod] = useState('30');
  const [selectedOrg, setSelectedOrg] = useState('');

  const path = `/api/metrics/overview?period=${period}${isSystem && selectedOrg ? `&tenantId=${selectedOrg}` : ''}`;
  const { data, loading, error } = useApiData(path);

  const organizations = data?.organizations || [];
  const summary = data?.summary || {};
  const voceros = data?.voceros || { top: [], bottom: [], total: 0 };
  const themes = data?.themes || { preferred: [], least: [], total: 0 };
  const isTenantScope = data?.scope === 'tenant';
  const selectedName = data?.tenant?.name || '';

  // Texto de alcance: el ADMIN nunca ve un selector (solo su organización).
  const scopeText = isSystem
    ? (isTenantScope ? t.scopeSelected(selectedName) : t.scopeAll)
    : t.scopeTenant;

  return (
    <section className="mt-10">
      {/* Barra de control: alcance + período */}
      <div className="flex flex-col lg:flex-row lg:items-center gap-3 mb-6">
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="text-[15px] font-semibold text-ink">{t.title}</h2>
          <Badge tone={isTenantScope ? 'accent' : 'brand'} icon={isTenantScope ? 'flag' : 'globe'}>
            {scopeText}
          </Badge>
        </div>
        <div className="lg:ml-auto flex items-center gap-3">
          <span className="text-[13px] text-muted">{t.period}</span>
          <PeriodPicker value={period} onChange={setPeriod} options={t.periods} />
        </div>
      </div>

      {error && (
        <Card className="mb-6">
          <EmptyState tone="danger" icon="server" title={t.loadFailed} description={error} />
        </Card>
      )}

      {/* Selector de organización (solo Administrador del Sistema) */}
      {isSystem && (
        <Card className="mb-6">
          <CardHeader
            title={t.orgTitle}
            description={t.orgDesc}
          />
          <select className="input sm:w-80" value={selectedOrg} onChange={(e) => setSelectedOrg(e.target.value)}>
            <option value="">{t.allOrgs}</option>
            {organizations.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
          {isTenantScope && (
            <p className="text-[13px] font-medium text-accent-fg mt-3">
              {t.orgScope(selectedName)}
            </p>
          )}
        </Card>
      )}

      {/* Resumen */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {isSystem && !isTenantScope && (
          <Stat label={t.stOrgs} value={loading && !data ? '—' : (summary.organizations ?? 0)} icon="globe" />
        )}
        {isSystem && !isTenantScope && (
          <Stat label={t.stOrgsCreated} value={loading && !data ? '—' : (summary.organizationsCreated ?? 0)} icon="plus" hint={t.stOrgsCreatedHint} />
        )}
        {isSystem && !isTenantScope && (
          <Stat
            label={t.stWon}
            value={loading && !data ? '—' : (summary.organizationsWon ?? 0)}
            icon="plus"
            hint={t.stWonHint}
          />
        )}
        {isSystem && !isTenantScope && (
          <Stat
            label={t.stLost}
            value={loading && !data ? '—' : (summary.organizationsLost ?? 0)}
            icon="trash"
            hint={t.stLostHint(summary.organizationsSuspended ?? 0)}
          />
        )}
        <Stat
          label={t.stConnected}
          value={loading && !data ? '—' : (summary.connected?.total ?? 0)}
          icon="zap"
          hint={t.stConnectedHint(summary.connected?.windowMinutes ?? 5, summary.connected?.byRole?.VOCERO ?? 0)}
        />
        <Stat label={t.stVoceros} value={loading && !data ? '—' : (summary.vocerosActive ?? 0)} icon="users" />
        <Stat label={t.stTrainings} value={loading && !data ? '—' : (summary.sessions ?? 0)} icon="activity" hint={t.stTrainingsHint} />
        <Stat label={t.stFrequency} value={loading && !data ? '—' : (summary.avgPerVocero ?? 0)} icon="target" hint={t.stFrequencyHint} />
        <Stat
          label={t.stCadence}
          value={loading && !data ? '—' : summary.avgDaysBetween != null ? t.stDays(summary.avgDaysBetween) : '—'}
          icon="calendar"
          hint={
            summary.avgDaysBetween != null
              ? t.stCadenceHint(summary.avgDaysBetween, summary.perWeek)
              : t.stCadenceNone
          }
        />
      </div>

      {/* Entrenamiento de voceros */}
      <h3 className="text-[15px] font-semibold text-ink mb-3">{t.vocerosSection}</h3>
      <Card className="mb-8">
        {voceros.total === 0 ? (
          <EmptyState icon="users" title={t.noActiveVoceros} description={t.noActiveVocerosDesc} />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <RankingList title={t.topVoceros} rows={voceros.top || []} tone="success" t={t} />
            <RankingList title={t.bottomVoceros} rows={voceros.bottom || []} tone="warning" t={t} />
          </div>
        )}
      </Card>

      {/* Temas */}
      <h3 className="text-[15px] font-semibold text-ink mb-3">{t.themesSection}</h3>
      <Card>
        {themes.total === 0 ? (
          <EmptyState icon="file" title={t.noThemes} description={t.noThemesDesc} />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <ThemeList title={t.topThemes} rows={themes.preferred || []} tone="success" t={t} />
            <ThemeList title={t.bottomThemes} rows={themes.least || []} tone="warning" t={t} />
          </div>
        )}
      </Card>
    </section>
  );
}
