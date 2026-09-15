import I from '../data/dictionary';

export default function VoceroHome() {
  const d = I.es;
  const t = d.L.u1;

  return (
    <div className="animate-fade-in pb-10">
      <div className="text-xs text-[var(--muted)] mb-1">{t.crumbs}</div>
      <h2 className="text-2xl font-bold mb-1 text-[var(--ink)]">{t.title}</h2>
      <p className="text-sm text-[var(--muted)] mb-6">{t.sub}</p>

      {/* Contenedor tipo "Navegador" que venía en el wireframe */}
      <div className="bg-[var(--panel)] border border-[var(--line2)] rounded-lg overflow-hidden shadow-sm">
        
        {/* Barra superior del navegador falso */}
        <div className="flex items-center gap-2 px-3 py-2 bg-[var(--chrome2)] border-b border-[var(--line)]">
          <span className="w-2.5 h-2.5 rounded-full bg-[var(--line)]"></span>
          <span className="w-2.5 h-2.5 rounded-full bg-[var(--line)]"></span>
          <span className="w-2.5 h-2.5 rounded-full bg-[var(--line)]"></span>
          <div className="flex-1 ml-2 bg-[var(--panel)] border border-[var(--line)] rounded-[5px] text-[11px] text-[var(--muted)] px-3 py-1">
            app.voxready.io/inicio
          </div>
        </div>

        {/* Lienzo de la aplicación */}
        <div className="p-5 md:p-6">
          
          {/* Fila de Estadísticas */}
          <div className="flex flex-col md:flex-row gap-4 mb-6">
            <div className="flex-1 border border-[var(--line)] rounded-lg bg-[var(--stat)] p-4">
              <div className="text-[11px] text-[var(--muted)]">{t.s1}</div>
              <div className="text-2xl font-bold mt-1 text-[var(--accent)]">12</div>
            </div>
            <div className="flex-1 border border-[var(--line)] rounded-lg bg-[var(--stat)] p-4">
              <div className="text-[11px] text-[var(--muted)]">{t.s2}</div>
              <div className="text-2xl font-bold mt-1 text-[var(--accent)]">74</div>
            </div>
            <div className="flex-1 border border-[var(--line)] rounded-lg bg-[var(--stat)] p-4">
              <div className="text-[11px] text-[var(--muted)]">{t.s3}</div>
              <div className="text-[15px] font-bold mt-1 text-[var(--accent)]">{t.s3v}</div>
            </div>
          </div>

          <div className="flex flex-col lg:flex-row gap-4">
            {/* Columna principal: Escenarios */}
            <div className="flex-[2] border border-[var(--line)] rounded-lg bg-[var(--panel)] p-4 md:p-5">
              <div className="text-[11px] text-[var(--muted)] uppercase tracking-wider font-bold mb-1">{t.sugT}</div>
              <div className="text-xs text-[var(--muted)] mb-4">{t.sugHelp}</div>
              
              {/* Tarjeta de Escenario 1 */}
              <div className="border border-[var(--line)] rounded-lg bg-[var(--panel)] p-4 mb-4 flex flex-col">
                <h4 className="text-sm font-bold mb-1">{t.c1n}</h4>
                <p className="text-xs text-[var(--muted)] mb-3 leading-relaxed">{t.c1c}</p>
                <div className="flex gap-2 flex-wrap mb-4">
                  {t.c1m.map((m, i) => (
                    <span key={i} className="text-[10.5px] text-[var(--muted)] border border-[var(--line)] rounded-md px-2 py-0.5">
                      {m}
                    </span>
                  ))}
                </div>
                <div>
                  <button className="inline-flex items-center gap-1.5 border border-[var(--accent2)] bg-[var(--accent2)] rounded-md px-4 py-1.5 text-xs text-white font-semibold hover:brightness-105 transition-all">
                    {d.practice}
                  </button>
                </div>
              </div>

              {/* Tarjeta de Escenario 2 */}
              <div className="border border-[var(--line)] rounded-lg bg-[var(--panel)] p-4 flex flex-col">
                <h4 className="text-sm font-bold mb-1">{t.c2n}</h4>
                <p className="text-xs text-[var(--muted)] mb-3 leading-relaxed">{t.c2c}</p>
                <div className="flex gap-2 flex-wrap mb-4">
                  {t.c2m.map((m, i) => (
                    <span key={i} className="text-[10.5px] text-[var(--muted)] border border-[var(--line)] rounded-md px-2 py-0.5">
                      {m}
                    </span>
                  ))}
                </div>
                <div>
                  <button className="inline-flex items-center gap-1.5 border border-[var(--accent)] bg-[var(--accent)] rounded-md px-4 py-1.5 text-xs text-white font-semibold hover:brightness-105 transition-all">
                    {d.practice}
                  </button>
                </div>
              </div>
            </div>

            {/* Columna lateral: Microlecciones */}
            <div className="flex-1 border border-[var(--line)] rounded-lg bg-[var(--panel)] p-4 md:p-5 lg:max-w-xs">
              <div className="text-[11px] text-[var(--muted)] uppercase tracking-wider font-bold mb-4">{t.microT}</div>
              {[t.m1, t.m2, t.m3].map((m, i) => (
                <div key={i} className="border border-[var(--line)] rounded-md bg-[var(--panel)] p-3 mb-2 cursor-pointer hover:border-[var(--accent)] hover:bg-[var(--accentsoft)] transition-colors group">
                  <div className="text-[13px] font-semibold mb-1 group-hover:text-[var(--accent)] transition-colors">{m}</div>
                  <div className="text-[11px] text-[var(--muted)]">{t.microMeta}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Nota UX */}
          <div className="mt-5 bg-[var(--note)] border border-[var(--noteline)] rounded-lg p-4 text-xs text-[var(--notetext)] leading-relaxed">
            <b className="font-bold">{d.noteUX}</b> {t.note}
          </div>

        </div>
      </div>
    </div>
  );
}