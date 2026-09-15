import { useNavigate } from 'react-router-dom';
import I from '../data/dictionary';

export default function Microleccion() {
  const d = I.es;
  const t = d.L.lesson;
  const navigate = useNavigate();

  return (
    <div className="animate-fade-in pb-10 max-w-3xl mx-auto">
      <div className="mb-4">
        <button onClick={() => navigate(-1)} className="text-xs font-semibold text-[var(--ink)] hover:text-[var(--accent)] flex items-center gap-1 transition-colors">
          {t.backTo}
        </button>
      </div>

      <div className="bg-[var(--panel)] border border-[var(--line)] rounded-lg p-6 shadow-sm mb-6">
        <div className="flex justify-between items-center mb-4">
          <h4 className="text-lg font-bold text-[var(--ink)]">Gestión de Emociones</h4>
          <span className="text-[10.5px] text-[var(--muted)] border border-[var(--line)] rounded-md px-2 py-0.5">
            {t.mins}
          </span>
        </div>
        
        <div className="text-[11px] text-[var(--muted)] uppercase tracking-wider font-bold mb-1.5">{t.objL}</div>
        <p className="text-xs text-[var(--muted)] mb-5 leading-relaxed">{t.obj}</p>
        
        <div className="h-40 border-2 border-dashed border-[var(--line2)] rounded-lg flex items-center justify-center text-xs text-[var(--muted)] mb-5 bg-[var(--stat)]">
          {t.vidL}
        </div>
        
        <div className="text-[11px] text-[var(--muted)] uppercase tracking-wider font-bold mb-1.5">{t.exL}</div>
        <div className="min-h-[60px] border border-[var(--line)] rounded-md bg-[var(--panel)] p-3 text-xs text-[var(--muted)] mb-6">
          {t.exV}
        </div>
        
        <button 
          onClick={() => navigate('/vocero/escenarios')}
          className="border border-[var(--accent2)] bg-[var(--accent2)] rounded-md px-5 py-2 text-xs text-white font-semibold hover:brightness-105 transition-all"
        >
          {t.cta}
        </button>
      </div>
      
      <div className="bg-[var(--note)] border border-[var(--noteline)] rounded-lg p-4 text-xs text-[var(--notetext)] leading-relaxed">
        <b className="font-bold">{d.noteUX}</b> {t.note}
      </div>
    </div>
  );
}