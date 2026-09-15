import I from '../data/dictionary';

export default function EditorRubrica() {
  const d = I.es;
  const t = d.L.m2;

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
            master.voxready.io/rubrica
          </div>
        </div>

        <div className="p-5 md:p-6">
          
          {/* Tabla de Áreas de Evaluación */}
          <div className="text-[11px] text-[var(--muted)] uppercase tracking-wider font-bold mb-3">{t.areasL}</div>
          <div className="overflow-x-auto border border-[var(--line)] rounded-lg mb-6">
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-col md:flex-row gap-6">
            {/* Descriptores */}
            <div className="flex-[2] border border-[var(--line)] rounded-lg p-5 bg-[var(--panel)]">
              <div className="text-[11px] text-[var(--muted)] uppercase tracking-wider font-bold mb-3">{t.descL}</div>
              <div className="min-h-[90px] border border-[var(--line)] rounded-md bg-[var(--panel)] p-3 text-xs text-[var(--muted)]">
                {t.descV}
              </div>
            </div>

            {/* Multiidioma */}
            <div className="flex-1 border border-[var(--line)] rounded-lg p-5 bg-[var(--panel)]">
              <div className="text-[11px] text-[var(--muted)] uppercase tracking-wider font-bold mb-3">{t.multiL}</div>
              <div className="flex gap-2 flex-wrap mb-3">
                <span className="border rounded-full px-3 py-1 text-[11px] font-semibold bg-[var(--accentsoft)] border-[var(--accent)] text-[var(--accent)]">ES</span>
                <span className="border rounded-full px-3 py-1 text-[11px] font-semibold bg-[var(--accentsoft)] border-[var(--accent)] text-[var(--accent)]">EN</span>
                <span className="border rounded-full px-3 py-1 text-[11px] bg-[var(--panel)] border-[var(--line2)] text-[var(--ink)]">PT</span>
              </div>
              <div className="text-xs text-[var(--muted)]">{t.multiLeg}</div>
            </div>
          </div>

          {/* Botones */}
          <div className="flex gap-3 mt-6">
            <button className="border border-[var(--accent2)] bg-[var(--accent2)] rounded-md px-5 py-2 text-xs text-white font-semibold hover:brightness-105 transition-all">
              {t.publish}
            </button>
            <button className="border border-[var(--line2)] bg-transparent px-5 py-2 rounded-md text-xs font-semibold text-[var(--ink)] hover:bg-[var(--soft)] transition-colors">
              {t.draft}
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