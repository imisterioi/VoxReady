import I from '../data/dictionary';

export default function AdminHome() {
  const d = I.es;
  const t = d.L.a1;
  const statValues = [6, 38, 152, 71]; // Valores hardcodeados del wireframe original

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
            admin.voxready.io/panel
          </div>
        </div>

        <div className="p-5 md:p-6">
          {/* Estadísticas */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            {t.st.map((k, i) => (
              <div key={i} className="border border-[var(--line)] rounded-lg bg-[var(--stat)] p-4 text-center md:text-left">
                <div className="text-[11px] text-[var(--muted)] mb-1">{k}</div>
                <div className="text-2xl font-bold text-[var(--accent)]">{statValues[i]}</div>
              </div>
            ))}
          </div>

          {/* Tabla de Temas */}
          <div className="flex items-center justify-between mb-3 mt-8">
            <div className="text-[11px] text-[var(--muted)] uppercase tracking-wider font-bold m-0">{t.themesL}</div>
            <button className="bg-[var(--accent2)] text-white text-xs font-semibold px-4 py-1.5 rounded-md hover:brightness-105 transition-all">
              {t.newT}
            </button>
          </div>

          <div className="overflow-x-auto border border-[var(--line)] rounded-lg">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-[var(--soft)] text-[var(--muted)]">
                  {t.th.map((h, i) => (
                    <th key={i} className="p-3 font-semibold border-b border-[var(--line)]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {t.rows.map((row, i) => (
                  <tr key={i} className="border-b border-[var(--line)] last:border-0 hover:bg-[var(--stat)] transition-colors">
                    {row.map((cell, j) => (
                      <td key={j} className="p-3 text-[var(--ink)]">{cell}</td>
                    ))}
                    <td className="p-3 text-right">
                      <button className="border border-[var(--line2)] bg-[var(--panel)] px-3 py-1.5 rounded-md text-xs font-semibold hover:bg-[var(--soft)] transition-colors">
                        {t.edit}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-5 bg-[var(--note)] border border-[var(--noteline)] rounded-lg p-4 text-xs text-[var(--notetext)] leading-relaxed">
            <b className="font-bold">{d.noteUX}</b> {t.note}
          </div>
        </div>
      </div>
    </div>
  );
}