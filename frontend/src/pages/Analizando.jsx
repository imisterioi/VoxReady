import { useNavigate } from 'react-router-dom';
import I from '../data/dictionary';

export default function Analizando() {
  const d = I.es;
  const t = d.L.u5;
  const navigate = useNavigate();

  return (
    <div className="animate-fade-in pb-10">
      <div className="text-xs text-[var(--muted)] mb-1">{t.crumbs}</div>
      <h2 className="text-2xl font-bold mb-1 text-[var(--ink)]">{t.title}</h2>
      <p className="text-sm text-[var(--muted)] mb-6">{t.sub}</p>

      <div className="bg-[var(--panel)] border border-[var(--line2)] rounded-lg overflow-hidden shadow-sm">
        
        <div className="flex items-center gap-2 px-3 py-2 bg-[var(--chrome2)] border-b border-[var(--line)]">
          <span className="w-2.5 h-2.5 rounded-full bg-[var(--line)]"></span>
          <span className="w-2.5 h-2.5 rounded-full bg-[var(--line)]"></span>
          <span className="w-2.5 h-2.5 rounded-full bg-[var(--line)]"></span>
          <div className="flex-1 ml-2 bg-[var(--panel)] border border-[var(--line)] rounded-[5px] text-[11px] text-[var(--muted)] px-3 py-1">
            app.voxready.io/sesion/procesando
          </div>
        </div>

        <div className="p-10 md:p-16 flex justify-center">
          <div className="border border-[var(--line)] rounded-xl bg-[var(--panel)] p-10 text-center w-full max-w-lg shadow-sm">
            
            {/* Icono animado */}
            <div className="h-16 w-16 border-4 border-[var(--line)] border-t-[var(--accent)] rounded-full animate-spin mx-auto mb-6"></div>
            
            <div className="text-lg font-bold mb-2">{t.head}</div>
            <div className="text-[13px] text-[var(--muted)] mb-8">{t.small}</div>
            
            {/* Lista de pasos de análisis */}
            <div className="text-left space-y-3">
              <div className="flex justify-between text-xs items-center bg-[var(--stat)] p-3 rounded-lg border border-[var(--line)]">
                <span className="font-medium text-[var(--ink)]">{t.p1}</span>
                <span className="text-[#3b6d11] font-bold text-sm">✓</span>
              </div>
              <div className="flex justify-between text-xs items-center bg-[var(--stat)] p-3 rounded-lg border border-[var(--line)]">
                <span className="font-medium text-[var(--ink)]">{t.p2}</span>
                <span className="text-[#3b6d11] font-bold text-sm">✓</span>
              </div>
              <div className="flex justify-between text-xs items-center bg-[var(--stat)] p-3 rounded-lg border border-[var(--accent)] shadow-[0_0_0_1px_var(--accent)]">
                <span className="font-bold text-[var(--accent)]">{t.p3}</span>
                <span className="text-[var(--accent)] animate-pulse">…</span>
              </div>
              <div className="flex justify-between text-xs items-center p-3 rounded-lg border border-transparent opacity-60">
                <span className="text-[var(--muted)]">{t.p4}</span>
                <span className="text-[var(--muted)]">·</span>
              </div>
            </div>

            {/* Botón para avanzar manualmente por ahora */}
            <div className="mt-10">
              <button 
                onClick={() => navigate('/vocero/informe')}
                className="bg-[var(--accent2)] border border-[var(--accent2)] rounded-md px-8 py-2.5 text-sm text-white font-bold hover:brightness-105 transition-all w-full sm:w-auto"
              >
                Ver Informe de Resultados →
              </button>
            </div>
          </div>
        </div>

        <div className="m-5 md:m-6 mt-0 bg-[var(--note)] border border-[var(--noteline)] rounded-lg p-4 text-xs text-[var(--notetext)] leading-relaxed">
          <b className="font-bold">{d.noteUX}</b> {t.note}
        </div>

      </div>
    </div>
  );
}