import { useNavigate } from 'react-router-dom';
import I from '../data/dictionary';
import Icon from '../components/Icon';
import PracticeSteps from '../components/PracticeSteps';
import { Badge, Button, Card, PageHeader, Progress, ScoreRing } from '../components/ui';

export default function InformeCoach() {
  const t = I.es.L.u6;
  const navigate = useNavigate();

  const areaScores = [70, 81, 79, 58];
  const areaIcons = ['person', 'mic', 'message', 'users'];
  const weakest = areaScores.indexOf(Math.min(...areaScores));

  return (
    <>
      <PracticeSteps />
      <PageHeader
        eyebrow={`${t.scen} · ${t.date}`}
        title={t.title}
        actions={
          <>
            <Button variant="secondary" icon="play">
              {t.watch}
            </Button>
            <Button variant="accent" icon="repeat" onClick={() => navigate('/vocero/preparar')}>
              {t.redo}
            </Button>
          </>
        }
      />

      {/* Resumen coach */}
      <Card className="p-0 overflow-hidden mb-6">
        <div className="grid grid-cols-1 md:grid-cols-[260px_1fr]">
          <div className="flex flex-col items-center justify-center gap-4 p-8 border-b md:border-b-0 md:border-r border-line bg-subtle/40">
            <ScoreRing value={74} />
            <div className="text-center">
              <div className="text-sm font-medium text-ink">{t.globalL}</div>
              <div className="text-xs text-success mt-1">+6 vs. sesión anterior</div>
            </div>
          </div>

          <div className="p-6 md:p-8">
            <blockquote className="font-display font-medium text-[20px] md:text-[23px] leading-[1.45] tracking-[-0.015em] text-ink">“{t.quote}”</blockquote>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mt-8">
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <span className="h-6 w-6 rounded-md bg-success/10 text-success flex items-center justify-center">
                    <Icon name="check" size={13} strokeWidth={2.5} />
                  </span>
                  <span className="text-sm font-semibold text-ink">{t.good}</span>
                </div>
                <ul className="space-y-2">
                  {t.goodItems.map((g) => (
                    <li key={g} className="text-[13px] text-muted leading-relaxed pl-8">{g}</li>
                  ))}
                </ul>
              </div>
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <span className="h-6 w-6 rounded-md bg-accent-soft text-accent flex items-center justify-center">
                    <Icon name="target" size={13} strokeWidth={2} />
                  </span>
                  <span className="text-sm font-semibold text-ink">{t.improve}</span>
                </div>
                <ul className="space-y-2">
                  {t.improveItems.map((g) => (
                    <li key={g} className="text-[13px] text-muted leading-relaxed pl-8">{g}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      </Card>

      {/* Detalle por área */}
      <h2 className="text-[15px] font-semibold text-ink mb-4">{t.detail}</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {t.areas.map((area, i) => (
          <Card key={area} className="p-5">
            <div className="flex items-center justify-between mb-5">
              <span className="h-9 w-9 rounded-lg bg-subtle text-ink flex items-center justify-center">
                <Icon name={areaIcons[i]} size={16} />
              </span>
              {i === weakest && <Badge tone="accent">A reforzar</Badge>}
            </div>
            <div className="text-[13px] text-muted">{area}</div>
            <div className="text-[28px] font-semibold tracking-tight text-ink tabular-nums mt-1 mb-4">
              {areaScores[i]}
              <span className="text-sm text-faint font-normal"> /100</span>
            </div>
            <Progress value={areaScores[i]} tone={i === weakest ? 'accent' : 'ink'} />
          </Card>
        ))}
      </div>

      <Card className="mt-6 flex flex-col sm:flex-row sm:items-center gap-4 bg-subtle/40 border-dashed">
        <span className="h-10 w-10 rounded-xl bg-accent-soft text-accent flex items-center justify-center">
          <Icon name="book" size={18} />
        </span>
        <div className="flex-1">
          <div className="text-sm font-medium text-ink">Refuerza tu empatía</div>
          <div className="text-[13px] text-muted">Una microlección de 4 minutos puede ayudarte antes de tu próxima práctica.</div>
        </div>
        <Button variant="secondary" to="/vocero/leccion" iconRight="arrowRight">
          {I.es.openLesson}
        </Button>
      </Card>
    </>
  );
}
