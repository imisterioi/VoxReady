import { useNavigate } from 'react-router-dom';
import I from '../data/dictionary';

export default function InformeCoach() {
  const d = I.es;
  const t = d.L.u6;
  const navigate = useNavigate();

  // Puntajes del wireframe original
  const areaScores = [70, 81, 79, 58];

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
            app.voxready.io/informe/8842
          </div>
        </div>

        <div className="p-5 md:p-6">
          
          {/* Tarjeta Superior: Narrativa y Puntaje Global */}
          <div className="border border-[var(--line)] rounded-lg bg-[var(--panel)] p-5 mb-5">
            <div className="flex justify-between items-center mb-4">
              <div>
                <div className="text-[11px] text-[var(--muted)] uppercase tracking-wider font-bold m-0">{t.globalL}</div>
                <div className="text-[13px] text-[var(--muted)]">{t.scenLine}</div>
              </div>
              <div className="text-center">
                <div className="text-3xl font-bold text-[var(--accent)] leading-none">74</div>
                <div className="text-[11px] text-[var(--muted)]">/100</div>
              </div>
            </div>

            {/* Placeholder de "Lo que hiciste bien" */}
            <div className="text-[11px] text-[var(--muted)] uppercase tracking-wider font-bold mb-1.5">{t.good}</div>
            <div className="h-2.5 bg-[var(--barfill)] rounded-sm w-[92%] mb-1.5"></div>
            <div className="h-2.5 bg-[var(--barfill)] rounded-sm w-[92%] mb-4"></div>

            {/* Placeholder de "Qué mejorar" */}
            <div className="text-[11px] text-[var(--muted)] uppercase tracking-wider font-bold mb-1.5">{t.improve}</div>
            <div className="h-2.5 bg-[var(--barfill)] rounded-sm w-[92%] mb-1.5"></div>
            <div className="h-2.5 bg-[var(--barfill)] rounded-sm w-[75%] mb-4"></div>

            {/* Cita del coach */}
            <div className="bg-[var(--soft)] p-3 rounded-md text-xs text-[var(--muted)] italic border-l-4 border-[var(--accent2)]">
              {t.quote}
            </div>
          </div>

          {/* Tarjetas de Detalle por Área */}
          <div className="text-[11px] text-[var(--muted)] uppercase tracking-wider font-bold mb-3">{t.detail}</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
            {t.areas.map((area, i) => (
              <div key={i} className="border border-[var(--line)] rounded-lg p-3 bg-[var(--panel)] shadow-sm">
                <div className="flex justify-between items-baseline mb-2">
                  <span className="text-[13px] font-semibold text-[var(--ink)]">{area}</span>
                  <span className="text-lg font-bold text-[var(--accent)]">{areaScores[i]}</span>
                </div>
                <div className="h-2.5 rounded-[5px] bg-[var(--barfill)] overflow-hidden">
                  <div 
                    className="h-full bg-[var(--accent)] rounded-r-[5px] transition-all duration-1000" 
                    style={{ width: `${areaScores[i]}%` }}
                  ></div>
                </div>
              </div>
            ))}
          </div>

          {/* Botones de acción final */}
          <div className="flex flex-wrap gap-3 mt-5">
            <button className="border border-[var(--line2)] bg-transparent px-5 py-2 rounded-md text-xs font-semibold text-[var(--ink)] hover:bg-[var(--soft)] transition-colors">
              {t.watch}
            </button>
            <button 
              onClick={() => navigate('/vocero/preparar')}
              className="border border-[var(--accent2)] bg-[var(--accent2)] rounded-md px-5 py-2 text-xs text-white font-semibold hover:brightness-105 transition-all"
            >
              {t.redo}
            </button>
          </div>

          <div className="mt-6 bg-[var(--note)] border border-[var(--noteline)] rounded-lg p-4 text-xs text-[var(--notetext)] leading-relaxed">
            <b className="font-bold">{d.noteUX}</b> {t.note}
          </div>

        </div>
      </div>
    </div>
  );
}