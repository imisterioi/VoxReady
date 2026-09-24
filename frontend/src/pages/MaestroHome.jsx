import I from '../data/dictionary';
import Icon from '../components/Icon';
import { Badge, Button, Card, CardHeader, PageHeader, Stat } from '../components/ui';

// Distribución ilustrativa de puntajes globales (rangos de 10 puntos)
const HISTOGRAM = [
  { range: '30', count: 4 },
  { range: '40', count: 11 },
  { range: '50', count: 38 },
  { range: '60', count: 96 },
  { range: '70', count: 182 },
  { range: '80', count: 214 },
  { range: '90', count: 95 },
];

export default function MaestroHome() {
  const t = I.es.L.m1;
  const statValues = ['9', '640', '23', '88%'];
  const statIcons = ['users', 'activity', 'tag', 'target'];
  const max = Math.max(...HISTOGRAM.map((h) => h.count));

  return (
    <>
      <PageHeader
        eyebrow={t.eyebrow}
        title={t.title}
        description={t.sub}
        actions={
          <Button to="/maestro/etiquetado" icon="tag">
            Revisar cola
          </Button>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {t.st.map((k, i) => (
          <Stat key={k} label={k} value={statValues[i]} icon={statIcons[i]} />
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.6fr] gap-6">
        {/* Versión del patrón */}
        <Card className="flex flex-col">
          <CardHeader title={t.verL} description={t.verLeg} />
          <div className="flex items-baseline gap-3">
            <span className="font-display font-semibold text-[56px] leading-none tracking-[-0.03em] text-ink">v0.4</span>
            <Badge tone="success" icon="check">Vigente</Badge>
          </div>
          <ul className="mt-6 space-y-2.5 text-[13px] text-muted">
            <li className="flex items-center gap-2"><Icon name="clock" size={14} className="text-faint" /> Publicada el 18 jun 2026</li>
            <li className="flex items-center gap-2"><Icon name="sliders" size={14} className="text-faint" /> 4 áreas · 12 criterios</li>
            <li className="flex items-center gap-2"><Icon name="globe" size={14} className="text-faint" /> ES · EN · PT</li>
          </ul>
          <Button variant="secondary" to="/maestro/rubrica" iconRight="arrowRight" className="mt-8 w-full">
            {t.openRub}
          </Button>
        </Card>

        {/* Histograma */}
        <Card>
          <CardHeader title={t.distL} description={t.distSub} />
          <div className="flex items-end gap-3 h-48">
            {HISTOGRAM.map((h) => (
              <div key={h.range} className="group flex-1 flex flex-col items-center justify-end h-full">
                <span className="text-[11px] text-muted tabular-nums mb-1.5 opacity-0 group-hover:opacity-100 transition-opacity">{h.count}</span>
                <div
                  className="w-full rounded-t-md bg-brand/80 group-hover:bg-accent transition-colors"
                  style={{ height: `${(h.count / max) * 100}%` }}
                />
              </div>
            ))}
          </div>
          <div className="flex gap-3 mt-2 pt-2 border-t border-line">
            {HISTOGRAM.map((h) => (
              <span key={h.range} className="flex-1 text-center text-[11px] text-faint tabular-nums">{h.range}</span>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}
