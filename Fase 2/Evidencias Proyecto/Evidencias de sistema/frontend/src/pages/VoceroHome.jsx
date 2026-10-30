import { Link, useNavigate } from 'react-router-dom';
import { useI18n } from '../lib/i18n';
import { getCurrentUser } from '../lib/api';
import Icon from '../components/Icon';
import { Badge, Button, Card, CardHeader, EmptyState, PageHeader, Stat } from '../components/ui';
import useApiData from '../hooks/useApiData';
import { lessonsForArea, localizedLesson } from '../data/lessons';
import { formatDate } from '../data/directory';

const CATEGORY = {
  CRISIS: { tone: 'danger', icon: 'alert' },
  MEDIOS: { tone: 'accent', icon: 'mic' },
  INSTITUCIONAL: { tone: 'neutral', icon: 'flag' },
};

// Inicio del vocero con sus datos reales
export default function VoceroHome() {
  const { d, lang } = useI18n();
  const t = d.L.u1;
  const categories = d.L.u2.categories;
  const navigate = useNavigate();
  const user = getCurrentUser() || {};
  const firstName = user.name?.split(' ')[0];

  const history = useApiData('/api/sessions');
  const scenariosData = useApiData('/api/scenarios/my');
  const sessions = history.data?.sessions || [];
  const scenarios = scenariosData.data?.scenarios || [];

  const latest = sessions[0];
  const previous = sessions[1];
  const measured = latest?.areas.filter((a) => a.score != null) || [];
  const weakest = measured.length ? measured.reduce((a, b) => (b.score < a.score ? b : a)) : null;
  const trend = latest && previous ? latest.score - previous.score : null;

  // Recomendados: primero los escenarios que aún no ha practicado
  const practiced = new Set(sessions.map((s) => s.theme?.id));
  const suggested = [...scenarios].sort((a, b) => Number(practiced.has(a.id)) - Number(practiced.has(b.id))).slice(0, 2);
  const lessons = lessonsForArea(weakest?.key, 3).map((l) => localizedLesson(l, lang));

  const start = (scenario) => {
    sessionStorage.setItem('voxready_escenario_seleccionado', JSON.stringify(scenario));
    navigate('/vocero/preparar');
  };

  return (
    <>
      <PageHeader
        eyebrow={firstName ? `${t.greet}, ${firstName}` : t.greet}
        title={t.title}
        description={t.sub}
        actions={
          <>
            <Button to="/vocero/progreso" variant="secondary" icon="chart">
              {t.progress}
            </Button>
            <Button to="/vocero/escenarios" variant="accent" icon="mic">
              {d.practice}
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-10">
        <Stat label={t.s1} value={history.data ? sessions.length : '—'} icon="check" hint={t.statEvaluated} />
        <Stat
          label={t.s2}
          value={latest?.score ?? '—'}
          icon="target"
          trend={trend != null ? `${trend >= 0 ? '+' : ''}${trend}` : undefined}
          hint={latest ? latest.theme?.title : t.statNoPractices}
        />
        <Stat
          label={t.s3}
          value={<span className="text-2xl">{weakest?.label || '—'}</span>}
          icon="alert"
          hint={weakest ? t.statWeakest(weakest.score) : t.statWeakestPending}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Escenarios asignados */}
        <div className="lg:col-span-2">
          <div className="flex items-end justify-between mb-4">
            <div>
              <h2 className="text-[15px] font-semibold text-ink">{t.scenariosL}</h2>
              <p className="text-[13px] text-muted mt-0.5">{scenarios.length ? t.scenariosCount(scenarios.length) : t.scenariosDefault}</p>
            </div>
            <Link to="/vocero/escenarios" className="text-[13px] font-medium text-muted hover:text-ink inline-flex items-center gap-1">
              {t.viewAll} <Icon name="arrowRight" size={14} />
            </Link>
          </div>

          {suggested.length === 0 ? (
            <Card>
              <EmptyState
                icon="layers"
                title={scenariosData.loading ? t.loadingScenarios : t.noAssigned}
                description={scenariosData.error || t.noAssignedDesc}
              />
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {suggested.map((s) => {
                const cat = CATEGORY[s.category] || { tone: 'neutral', icon: 'layers' };
                const catLabel = categories[s.category] || s.category;
                return (
                  <Card key={s.id} className="group flex flex-col hover:shadow-lift hover:border-line-strong transition-all">
                    <div className="flex items-center justify-between mb-6">
                      <span className="h-10 w-10 rounded-xl bg-subtle flex items-center justify-center text-ink">
                        <Icon name={cat.icon} size={18} />
                      </span>
                      <div className="flex gap-1.5">
                        {practiced.has(s.id) && <Badge tone="success" icon="check">{t.practiced}</Badge>}
                        <Badge tone={cat.tone}>{catLabel}</Badge>
                      </div>
                    </div>
                    <h3 className="text-[17px] font-semibold tracking-tight text-ink">{s.title}</h3>
                    <p className="text-[13px] text-muted mt-2 leading-relaxed flex-1 line-clamp-3">{s.context}</p>
                    <div className="flex items-center justify-end mt-6 pt-5 border-t border-line">
                      <Button size="sm" iconRight="arrowRight" onClick={() => start(s)}>
                        {d.practice}
                      </Button>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>

        {/* Microlecciones recomendadas y último informe */}
        <div>
          <div className="mb-4">
            <h2 className="text-[15px] font-semibold text-ink">{t.microT}</h2>
            <p className="text-[13px] text-muted mt-0.5">{weakest ? t.microSub(weakest.label.toLowerCase()) : t.microFallback}</p>
          </div>
          <Card padded={false} className="divide-y divide-line overflow-hidden">
            {lessons.map((m) => (
              <Link key={m.id} to={`/vocero/leccion/${m.id}`} className="group flex items-center gap-4 p-4 hover:bg-subtle/60 transition-colors">
                <span className="h-10 w-10 rounded-xl bg-accent-soft text-accent-fg flex items-center justify-center">
                  <Icon name={m.icon} size={18} />
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-medium text-ink">{m.title}</span>
                  <span className="block text-xs text-muted mt-0.5">{m.minutes} min · {t.video}</span>
                </span>
                <Icon name="chevronRight" size={16} className="text-faint group-hover:text-ink transition-colors" />
              </Link>
            ))}
          </Card>

          <Card className="mt-4 bg-subtle/50 border-dashed">
            <CardHeader
              className="mb-3"
              title={t.lastReport}
              description={latest ? `${latest.theme?.title} · ${latest.score}/100 · ${formatDate(latest.completedAt, lang)}` : t.noReports}
            />
            <Button
              to={latest ? `/vocero/informe?sesion=${latest.id}` : '/vocero/escenarios'}
              variant="secondary"
              size="sm"
              iconRight="arrowRight"
              className="w-full"
            >
              {latest ? t.openReport : t.firstPractice}
            </Button>
          </Card>
        </div>
      </div>
    </>
  );
}
