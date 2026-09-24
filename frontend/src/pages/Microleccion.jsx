import { useNavigate } from 'react-router-dom';
import I from '../data/dictionary';
import Icon from '../components/Icon';
import { Badge, Button, Card } from '../components/ui';

export default function Microleccion() {
  const t = I.es.L.lesson;
  const navigate = useNavigate();

  return (
    <div className="max-w-3xl mx-auto">
      <Button variant="ghost" size="sm" icon="arrowLeft" onClick={() => navigate(-1)} className="-ml-3 mb-8">
        {t.backTo}
      </Button>

      <div className="flex items-center gap-2 mb-4">
        <span className="eyebrow">{t.eyebrow}</span>
        <Badge tone="outline" icon="clock">{t.mins}</Badge>
      </div>
      <h1 className="font-display font-semibold text-[36px] md:text-[48px] leading-[1.1] tracking-[-0.03em] text-ink">{t.title}</h1>

      <div className="mt-8 rounded-2xl border border-line bg-subtle/40 p-5 flex gap-4">
        <Icon name="target" size={20} className="text-accent mt-0.5" />
        <div>
          <div className="text-sm font-medium text-ink">{t.objL}</div>
          <p className="text-[15px] text-muted mt-1 leading-relaxed">{t.obj}</p>
        </div>
      </div>

      {/* Video */}
      <div className="group relative mt-8 aspect-video rounded-2xl overflow-hidden bg-gradient-to-br from-[#16263A] to-[#0B1118] flex items-center justify-center cursor-pointer">
        <span className="h-16 w-16 rounded-full bg-white/95 text-[#0F1B2A] flex items-center justify-center shadow-2xl group-hover:scale-105 transition-transform">
          <Icon name="play" size={24} className="ml-1" />
        </span>
        <span className="absolute bottom-4 left-4 text-xs text-white/60">Video · 3:42</span>
      </div>

      {/* Ejemplo comentado */}
      <h2 className="text-[15px] font-semibold text-ink mt-12 mb-4">{t.exL}</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="p-5">
          <Badge tone="danger" icon="x">{t.exBefore}</Badge>
          <p className="text-[15px] text-muted mt-4 leading-relaxed italic">{t.exBeforeV}</p>
        </Card>
        <Card className="p-5 border-success/30">
          <Badge tone="success" icon="check">{t.exAfter}</Badge>
          <p className="text-[15px] text-ink mt-4 leading-relaxed">{t.exAfterV}</p>
        </Card>
      </div>

      <div className="mt-12 pt-8 border-t border-line flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <p className="text-sm text-muted">¿Listo para aplicarlo?</p>
        <Button variant="accent" size="lg" iconRight="arrowRight" onClick={() => navigate('/vocero/escenarios')}>
          {t.cta}
        </Button>
      </div>
    </div>
  );
}
