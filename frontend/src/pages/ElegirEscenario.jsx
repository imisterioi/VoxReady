import { useNavigate } from 'react-router-dom';
import I from '../data/dictionary';

export default function ElegirEscenario() {
  const d = I.es;
  const t = d.L.u2;
  const navigate = useNavigate();

  return (
    <div className="animate-fade-in pb-10">
      <div className="text-xs text-[var(--muted)] mb-1">{t.crumbs}</div>
      <h2 className="text-2xl font-bold mb-1 text-[var(--ink)]">{t.title}</h2>
      <p className="text-sm text-[var(--muted)] mb-6">{t.sub}</p>

      <div className="bg-[var(--panel)] border border-[var(--line2)] rounded-lg overflow-hidden shadow-sm">
        
        {/* Barra del navegador falso */}
        <div className="flex items-center gap-2 px-3 py-2 bg-[var(--chrome2)] border-b border-[var(--line)]">
          <span className="w-2.5 h-2.5 rounded-full bg-[var(--line)]"></span>
          <span className="w-2.5 h-2.5 rounded-full bg-[var(--line)]"></span>
          <span className="w-2.5 h-2.5 rounded-full bg-[var(--line)]"></span>
          <div className="flex-1 ml-2 bg-[var(--panel)] border border-[var(--line)] rounded-[5px] text-[11px] text-[var(--muted)] px-3 py-1">
            app.voxready.io/escenarios
          </div>
        </div>

        <div className="p-5 md:p-6">
          
          {/* Filtros y Búsqueda */}
          <div className="flex flex-col md:flex-row gap-4 mb-6">
            <div className="flex gap-2 flex-wrap">
              {t.filters.map((f, i) => (
                <span 
                  key={i} 
                  className={`border rounded-full px-3 py-1 text-[11px] cursor-pointer font-semibold transition-colors
                    ${i === 0 
                      ? 'bg-[var(--accentsoft)] border-[var(--accent)] text-[var(--accent)]' 
                      : 'bg-[var(--panel)] border-[var(--line2)] text-[var(--ink)] hover:bg-[var(--soft)]'
                    }`}
                >
                  {f}
                </span>
              ))}
            </div>
            <input 
              type="text" 
              placeholder={t.search}
              className="md:ml-auto w-full md:w-64 h-[34px] border border-[var(--line)] rounded-md bg-[var(--panel)] px-3 text-xs text-[var(--ink)] focus:outline-none focus:border-[var(--accent)]"
            />
          </div>

          {/* Grid de Escenarios Simulados */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3, 4, 5, 6].map(i => (
              <div key={i} className="border border-[var(--line)] rounded-lg bg-[var(--panel)] p-4 flex flex-col hover:shadow-md hover:border-[var(--line2)] transition-all">
                
                {/* Placeholder de la imagen (manteniendo el estilo rayado del wireframe) */}
                <div className="h-20 border border-dashed border-[var(--line2)] rounded-md flex items-center justify-center text-xs text-[var(--muted)] mb-3"
                     style={{ background: 'repeating-linear-gradient(135deg, var(--soft), var(--soft) 7px, var(--bg) 7px, var(--bg) 14px)' }}>
                  {t.img}
                </div>
                
                {/* Líneas falsas de texto */}
                <div className="h-2.5 bg-[var(--barfill)] rounded-sm w-3/4 mb-2.5"></div>
                <div className="h-2 bg-[var(--barfill)] rounded-sm w-full mb-1.5"></div>
                <div className="h-2 bg-[var(--barfill)] rounded-sm w-1/2 mb-5"></div>
                
                {/* Botones inferiores */}
                <div className="mt-auto flex justify-between items-center">
                  <span className="border border-[var(--line2)] rounded-full px-3 py-1 text-[11px] bg-[var(--panel)] font-medium">
                    {i % 2 !== 0 ? t.dir : t.plant}
                  </span>
                  <button 
                    onClick={() => navigate('/vocero/preparar')}
                    className="border border-[var(--accent2)] bg-[var(--accent2)] rounded-md px-4 py-1.5 text-xs text-white font-semibold hover:brightness-105 transition-all"
                  >
                    {t.start}
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-6 bg-[var(--note)] border border-[var(--noteline)] rounded-lg p-4 text-xs text-[var(--notetext)] leading-relaxed">
            <b className="font-bold">{d.noteUX}</b> {t.note}
          </div>

        </div>
      </div>
    </div>
  );
}