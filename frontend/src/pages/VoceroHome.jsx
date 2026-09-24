import { Link } from 'react-router-dom';
import I from '../data/dictionary';
import Icon from '../components/Icon';
import { Badge, Button, Card, CardHeader, PageHeader, Stat } from '../components/ui';

export default function VoceroHome() {
  const d = I.es;
  const t = d.L.u1;
  const user = JSON.parse(localStorage.getItem('voxready_user') || '{}');
  const firstName = user.name?.split(' ')[0];

  const scenarios = [
    { name: t.c1n, desc: t.c1c, meta: t.c1m, tone: 'warning' },
    { name: t.c2n, desc: t.c2c, meta: t.c2m, tone: 'danger' },
  ];

  const lessons = [
    { name: t.m1, icon: 'message' },
    { name: t.m2, icon: 'zap' },
    { name: t.m3, icon: 'person' },
  ];

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
        <Stat label={t.s1} value="12" icon="check" hint="+3 este mes" />
        <Stat label={t.s2} value="74" icon="target" trend="+6" hint="Retiro de producto" />
        <Stat label={t.s3} value={<span className="text-2xl">{t.s3v}</span>} icon="alert" hint="58 / 100 en la última sesión" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Escenarios sugeridos */}
        <div className="lg:col-span-2">
          <div className="flex items-end justify-between mb-4">
            <div>
              <h2 className="text-[15px] font-semibold text-ink">{t.sugT}</h2>
              <p className="text-[13px] text-muted mt-0.5">{t.sugHelp}</p>
            </div>
            <Link to="/vocero/escenarios" className="text-[13px] font-medium text-muted hover:text-ink inline-flex items-center gap-1">
              Ver todos <Icon name="arrowRight" size={14} />
            </Link>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {scenarios.map((s) => (
              <Card key={s.name} className="group flex flex-col hover:shadow-lift hover:border-line-strong transition-all">
                <div className="flex items-center justify-between mb-6">
                  <span className="h-10 w-10 rounded-xl bg-subtle flex items-center justify-center text-ink">
                    <Icon name="mic" size={18} />
                  </span>
                  <Badge tone={s.tone}>{s.meta[1]}</Badge>
                </div>
                <h3 className="text-[17px] font-semibold tracking-tight text-ink">{s.name}</h3>
                <p className="text-[13px] text-muted mt-2 leading-relaxed flex-1">{s.desc}</p>
                <div className="flex items-center justify-between mt-6 pt-5 border-t border-line">
                  <div className="flex items-center gap-3 text-xs text-muted">
                    <span className="inline-flex items-center gap-1">
                      <Icon name="clock" size={13} /> {s.meta[0]}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Icon name="users" size={13} /> {s.meta[2]}
                    </span>
                  </div>
                  <Button to="/vocero/escenarios" size="sm" iconRight="arrowRight">
                    {d.practice}
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        </div>

        {/* Microlecciones */}
        <div>
          <div className="mb-4">
            <h2 className="text-[15px] font-semibold text-ink">{t.microT}</h2>
            <p className="text-[13px] text-muted mt-0.5">Teoría breve + ejemplo real</p>
          </div>
          <Card padded={false} className="divide-y divide-line overflow-hidden">
            {lessons.map((m) => (
              <Link
                key={m.name}
                to="/vocero/leccion"
                className="group flex items-center gap-4 p-4 hover:bg-subtle/60 transition-colors"
              >
                <span className="h-10 w-10 rounded-xl bg-accent-soft text-accent flex items-center justify-center">
                  <Icon name={m.icon} size={18} />
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-medium text-ink">{m.name}</span>
                  <span className="block text-xs text-muted mt-0.5">{t.microMeta}</span>
                </span>
                <Icon name="chevronRight" size={16} className="text-faint group-hover:text-ink transition-colors" />
              </Link>
            ))}
          </Card>

          <Card className="mt-4 bg-subtle/50 border-dashed">
            <CardHeader
              className="mb-3"
              title="Último informe"
              description="Retiro de producto · 74 / 100"
            />
            <Button to="/vocero/informe" variant="secondary" size="sm" iconRight="arrowRight" className="w-full">
              Abrir informe
            </Button>
          </Card>
        </div>
      </div>
    </>
  );
}
