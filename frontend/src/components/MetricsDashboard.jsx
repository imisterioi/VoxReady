import { useState } from 'react';
import { Avatar, Badge, Card, CardHeader, EmptyState, Segmented, Stat } from './ui';
import useApiData from '../hooks/useApiData';
import { getCurrentUser } from '../lib/api';
import { initialsOf } from '../data/directory';

// Dashboard de métricas administrativas. Consume /api/metrics/overview, que resuelve
// el alcance en el backend a partir del rol (y, para MASTER/SYSTEM, de la organización
// seleccionada). Todo el texto visible usa lenguaje de negocio (sin campos técnicos).

const PERIODS = [
  { value: '7', label: 'Últimos 7 días' },
  { value: '30', label: 'Últimos 30 días' },
  { value: '90', label: 'Últimos 90 días' },
  { value: '365', label: 'Últimos 12 meses' },
  { value: 'all', label: 'Todo el período' },
];

function PeriodPicker({ value, onChange }) {
  return <Segmented options={PERIODS} value={value} onChange={onChange} />;
}

function RankingList({ title, rows, tone }) {
  return (
    <div>
      <div className="text-[13px] font-medium text-muted mb-3">{title}</div>
      {rows.length === 0 ? (
        <p className="text-[13px] text-faint">Sin datos.</p>
      ) : (
        <ul className="space-y-2.5">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center gap-3">
              <Avatar initials={initialsOf(r.name)} size="sm" />
              <span className="flex-1 min-w-0 text-sm text-ink truncate">{r.name}</span>
              <Badge tone={tone}>{r.sessions} {r.sessions === 1 ? 'entrenamiento' : 'entrenamientos'}</Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ThemeList({ title, rows, tone }) {
  return (
    <div>
      <div className="text-[13px] font-medium text-muted mb-3">{title}</div>
      {rows.length === 0 ? (
        <p className="text-[13px] text-faint">Sin datos.</p>
      ) : (
        <ul className="space-y-2.5">
          {rows.map((t) => (
            <li key={t.id} className="flex items-center gap-3">
              <span className="flex-1 min-w-0 text-sm text-ink truncate">{t.title}</span>
              <Badge tone={tone}>{t.sessions} {t.sessions === 1 ? 'entrenamiento' : 'entrenamientos'}</Badge>
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
    ? (isTenantScope ? `Organización seleccionada: ${selectedName}` : 'Todas las organizaciones')
    : 'Estadísticas de tu organización';

  return (
    <section className="mt-10">
      {/* Barra de control: alcance + período */}
      <div className="flex flex-col lg:flex-row lg:items-center gap-3 mb-6">
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="text-[15px] font-semibold text-ink">Métricas</h2>
          <Badge tone={isTenantScope ? 'accent' : 'brand'} icon={isTenantScope ? 'flag' : 'globe'}>
            {scopeText}
          </Badge>
        </div>
        <div className="lg:ml-auto flex items-center gap-3">
          <span className="text-[13px] text-muted">Período</span>
          <PeriodPicker value={period} onChange={setPeriod} />
        </div>
      </div>

      {error && (
        <Card className="mb-6">
          <EmptyState tone="danger" icon="server" title="No se pudieron cargar las métricas" description={error} />
        </Card>
      )}

      {/* Selector de organización (solo Administrador del Sistema) */}
      {isSystem && (
        <Card className="mb-6">
          <CardHeader
            title="Organizaciones"
            description="Elige una organización para ver solo sus datos, o mantén todas para la vista global."
          />
          <select className="input sm:w-80" value={selectedOrg} onChange={(e) => setSelectedOrg(e.target.value)}>
            <option value="">Todas las organizaciones</option>
            {organizations.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
          {isTenantScope && (
            <p className="text-[13px] font-medium text-accent-fg mt-3">
              Estadísticas de esta organización: {selectedName}
            </p>
          )}
        </Card>
      )}

      {/* Resumen */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {isSystem && !isTenantScope && (
          <Stat label="Organizaciones" value={loading && !data ? '—' : (summary.organizations ?? 0)} icon="globe" />
        )}
        {isSystem && !isTenantScope && (
          <Stat label="Organizaciones creadas en el período" value={loading && !data ? '—' : (summary.organizationsCreated ?? 0)} icon="plus" hint="Según su fecha de creación" />
        )}
        {isSystem && !isTenantScope && (
          <Stat
            label="Clientes ganados"
            value={loading && !data ? '—' : (summary.organizationsWon ?? 0)}
            icon="plus"
            hint="Organizaciones creadas en el período, incluidas las que luego se eliminaron"
          />
        )}
        {isSystem && !isTenantScope && (
          <Stat
            label="Clientes perdidos"
            value={loading && !data ? '—' : (summary.organizationsLost ?? 0)}
            icon="trash"
            hint={`Organizaciones eliminadas en el período · ${summary.organizationsSuspended ?? 0} suspensión(es)`}
          />
        )}
        <Stat
          label="Usuarios conectados"
          value={loading && !data ? '—' : (summary.connected?.total ?? 0)}
          icon="zap"
          hint={`Con actividad en los últimos ${summary.connected?.windowMinutes ?? 5} min · ${summary.connected?.byRole?.VOCERO ?? 0} vocero(s)`}
        />
        <Stat label="Voceros activos" value={loading && !data ? '—' : (summary.vocerosActive ?? 0)} icon="users" />
        <Stat label="Entrenamientos" value={loading && !data ? '—' : (summary.sessions ?? 0)} icon="activity" hint="Prácticas completadas en el período" />
        <Stat label="Frecuencia" value={loading && !data ? '—' : (summary.avgPerVocero ?? 0)} icon="target" hint="Promedio de entrenamientos por vocero" />
        <Stat
          label="Cada cuánto entrenan"
          value={loading && !data ? '—' : summary.avgDaysBetween != null ? `${summary.avgDaysBetween} d` : '—'}
          icon="calendar"
          hint={
            summary.avgDaysBetween != null
              ? `Días entre dos entrenamientos del mismo vocero${summary.perWeek != null ? ` · ${summary.perWeek} por semana en total` : ''}`
              : 'Nadie entrenó dos veces en el período'
          }
        />
      </div>

      {/* Entrenamiento de voceros */}
      <h3 className="text-[15px] font-semibold text-ink mb-3">Entrenamiento de voceros</h3>
      <Card className="mb-8">
        {voceros.total === 0 ? (
          <EmptyState icon="users" title="Sin voceros activos" description="Cuando existan voceros activos verás aquí sus entrenamientos." />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <RankingList title="Con más entrenamientos" rows={voceros.top || []} tone="success" />
            <RankingList title="Con menos entrenamientos" rows={voceros.bottom || []} tone="warning" />
          </div>
        )}
      </Card>

      {/* Temas */}
      <h3 className="text-[15px] font-semibold text-ink mb-3">Temas</h3>
      <Card>
        {themes.total === 0 ? (
          <EmptyState icon="file" title="Sin temas" description="No hay temas con actividad en el período seleccionado." />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <ThemeList title="Temas más utilizados" rows={themes.preferred || []} tone="success" />
            <ThemeList title="Temas menos utilizados" rows={themes.least || []} tone="warning" />
          </div>
        )}
      </Card>
    </section>
  );
}
