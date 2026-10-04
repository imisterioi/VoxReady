import { Link, useNavigate } from 'react-router-dom';
import I from '../data/dictionary';
import { getCurrentUser } from '../lib/api';
import Icon from '../components/Icon';
import { Badge, Button, Card, CardHeader, EmptyState, PageHeader, Stat } from '../components/ui';
import useApiData from '../hooks/useApiData';
import { lessonsForArea } from '../data/lessons';
import { formatDate } from '../data/directory';

const CATEGORY = {
  CRISIS: { label: 'Crisis', tone: 'danger', icon: 'alert' },
  MEDIOS: { label: 'Medios', tone: 'accent', icon: 'mic' },
  INSTITUCIONAL: { label: 'Institucional', tone: 'neutral', icon: 'flag' },
};

// Inicio del vocero con sus datos reales
export default function VoceroHome() {
  const d = I.es;
  const t = d.L.u1;
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
  const lessons = lessonsForArea(weakest?.key, 3);

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
              Ver progreso
            </Button>
            <Button to="/vocero/escenarios" variant="accent" icon="mic">
              {d.practice}
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-10">
        <Stat label={t.s1} value={history.data ? sessions.length : '—'} icon="check" hint="Prácticas evaluadas" />
        <Stat
          label={t.s2}
          value={latest?.score ?? '—'}
          icon="target"
          trend={trend != null ? `${trend >= 0 ? '+' : ''}${trend}` : undefined}
          hint={latest ? latest.theme?.title : 'Aún sin prácticas'}
        />
        <Stat
          label={t.s3}
          value={<span className="text-2xl">{weakest?.label || '—'}</span>}
          icon="alert"
          hint={weakest ? `${weakest.score} / 100 en la última práctica` : 'Se calcula tras tu primera práctica'}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Escenarios asignados */}
        <div className="lg:col-span-2">
          <div className="flex items-end justify-between mb-4">
            <div>
              <h2 className="text-[15px] font-semibold text-ink">Tus escenarios</h2>
              <p className="text-[13px] text-muted mt-0.5">{scenarios.length ? `${scenarios.length} asignados · primero los que aún no practicas` : 'Asignados por tu organización'}</p>
            </div>
            <Link to="/vocero/escenarios" className="text-[13px] font-medium text-muted hover:text-ink inline-flex items-center gap-1">
              Ver todos <Icon name="arrowRight" size={14} />
            </Link>
          </div>

          {suggested.length === 0 ? (
            <Card>
              <EmptyState
                icon="layers"
                title={scenariosData.loading ? 'Cargando escenarios…' : 'Aún no tienes escenarios asignados'}
                description={scenariosData.error || 'Tu administrador te asignará escenarios para practicar.'}
              />
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {suggested.map((s) => {
                const cat = CATEGORY[s.category] || { label: s.category, tone: 'neutral', icon: 'layers' };
                return (
                  <Card key={s.id} className="group flex flex-col hover:shadow-lift hover:border-line-strong transition-all">
                    <div className="flex items-center justify-between mb-6">
                      <span className="h-10 w-10 rounded-xl bg-subtle flex items-center justify-center text-ink">
                        <Icon name={cat.icon} size={18} />
                      </span>
                      <div className="flex gap-1.5">
                        {practiced.has(s.id) && <Badge tone="success" icon="check">Practicado</Badge>}
                        <Badge tone={cat.tone}>{cat.label}</Badge>
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
            <p className="text-[13px] text-muted mt-0.5">{weakest ? `Para reforzar ${weakest.label.toLowerCase()}` : 'Teoría breve + video'}</p>
          </div>
          <Card padded={false} className="divide-y divide-line overflow-hidden">
            {lessons.map((m) => (
              <Link key={m.id} to={`/vocero/leccion/${m.id}`} className="group flex items-center gap-4 p-4 hover:bg-subtle/60 transition-colors">
                <span className="h-10 w-10 rounded-xl bg-accent-soft text-accent-fg flex items-center justify-center">
                  <Icon name={m.icon} size={18} />
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-medium text-ink">{m.title}</span>
                  <span className="block text-xs text-muted mt-0.5">{m.minutes} min · video</span>
                </span>
                <Icon name="chevronRight" size={16} className="text-faint group-hover:text-ink transition-colors" />
              </Link>
            ))}
          </Card>

          <Card className="mt-4 bg-subtle/50 border-dashed">
            <CardHeader
              className="mb-3"
              title="Último informe"
              description={latest ? `${latest.theme?.title} · ${latest.score}/100 · ${formatDate(latest.completedAt)}` : 'Aún no tienes informes'}
            />
            <Button
              to={latest ? `/vocero/informe?sesion=${latest.id}` : '/vocero/escenarios'}
              variant="secondary"
              size="sm"
              iconRight="arrowRight"
              className="w-full"
            >
              {latest ? 'Abrir informe' : 'Hacer mi primera práctica'}
            </Button>
          </Card>
        </div>
      </div>
    </>
  );
}
