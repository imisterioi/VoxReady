import { useNavigate } from 'react-router-dom';
import I from '../data/dictionary';
import Icon from '../components/Icon';
import PracticeSteps from '../components/PracticeSteps';
import { Button } from '../components/ui';

export default function SesionPractica() {
  const t = I.es.L.u4;
  const navigate = useNavigate();

  return (
    <>
      <PracticeSteps />

      <div className="rounded-[28px] bg-[#0B1118] p-3 md:p-4 ring-1 ring-black/5 shadow-lift">
        {/* Vista dividida 50/50 */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* Entrevistador IA */}
          <div className="relative aspect-[4/3] rounded-2xl overflow-hidden bg-gradient-to-br from-[#16263A] to-[#0E1824] flex items-center justify-center">
            <div className="relative">
              <span className="absolute inset-0 rounded-full bg-[#E0662A]/30 animate-pulse-ring" />
              <span className="relative h-24 w-24 rounded-full bg-gradient-to-br from-[#F08046] to-[#B84A18] flex items-center justify-center text-white shadow-2xl">
                <Icon name="sparkles" size={34} strokeWidth={1.5} />
              </span>
            </div>
            <div className="absolute top-4 left-4 flex items-center gap-2 rounded-full bg-white/10 backdrop-blur px-3 h-7 text-white/90 text-xs">
              <span className="h-1.5 w-1.5 rounded-full bg-[#F08046]" />
              {t.interviewer}
            </div>
            {/* Onda de voz */}
            <div className="absolute bottom-5 inset-x-0 flex items-end justify-center gap-1 h-6">
              {[40, 70, 100, 60, 85, 45, 90, 55, 75, 35, 65].map((h, i) => (
                <span key={i} className="w-1 rounded-full bg-white/30" style={{ height: `${h}%` }} />
              ))}
            </div>
          </div>

          {/* Self-view */}
          <div className="relative aspect-[4/3] rounded-2xl overflow-hidden bg-gradient-to-br from-[#1C242E] to-[#12181F] flex items-center justify-center">
            <div className="flex flex-col items-center gap-3 text-white/40">
              <Icon name="person" size={40} strokeWidth={1.25} />
              <span className="text-xs">{t.selfV}</span>
            </div>
            <div className="absolute top-4 right-4 flex items-center gap-2 rounded-full bg-black/50 backdrop-blur px-3 h-7 text-white text-xs tabular-nums">
              <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
              REC 02:14
            </div>
          </div>
        </div>

        {/* Subtítulo en vivo */}
        <div className="px-4 md:px-8 pt-8 pb-6 text-center">
          <div className="text-[11px] uppercase tracking-[0.14em] text-white/40 mb-4">{t.qL}</div>
          <p className="font-display font-medium text-[22px] md:text-[28px] leading-[1.35] tracking-[-0.015em] text-white max-w-3xl mx-auto">“{t.qEx}”</p>
        </div>

        {/* Controles */}
        <div className="flex flex-col md:flex-row md:items-center gap-4 rounded-2xl bg-white/[0.04] p-3 md:p-4">
          <div className="flex items-center gap-2">
            <button className="h-11 px-4 rounded-xl bg-white/10 hover:bg-white/15 text-white text-sm font-medium inline-flex items-center gap-2 transition-colors">
              <Icon name="pause" size={16} /> {t.pause}
            </button>
            <button className="h-11 px-4 rounded-xl hover:bg-white/10 text-white/70 hover:text-white text-sm font-medium inline-flex items-center gap-2 transition-colors">
              <Icon name="repeat" size={16} /> {t.repeat}
            </button>
          </div>

          <div className="flex items-center gap-3 md:flex-1 md:max-w-xs md:mx-auto">
            <div className="flex-1 h-1 rounded-full bg-white/10 overflow-hidden">
              <div className="h-full w-[38%] rounded-full bg-[#F08046]" />
            </div>
            <span className="text-xs text-white/50 whitespace-nowrap tabular-nums">{t.qn}</span>
          </div>

          <Button variant="accent" size="lg" onClick={() => navigate('/vocero/analizando')} className="md:ml-auto">
            {t.finish}
          </Button>
        </div>
      </div>

      <p className="text-center text-xs text-faint mt-6 flex items-center justify-center gap-1.5">
        <Icon name="info" size={13} /> {t.hint}
      </p>
    </>
  );
}
