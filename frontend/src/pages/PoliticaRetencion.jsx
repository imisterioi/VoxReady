import I from '../data/dictionary';

export default function PoliticaRetencion() {
  const d = I.es;
  const t = d.L.a3;

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
            admin.voxready.io/retencion
          </div>
        </div>

        <div className="p-5 md:p-6">
          
          <div className="border border-[var(--line)] rounded-lg bg-[var(--panel)] p-5 mb-4 shadow-sm">
            <div className="text-[11px] text-[var(--muted)] uppercase tracking-wider font-bold mb-3">{t.q1}</div>
            <label className="flex items-center gap-2 mb-3 cursor-pointer text-sm">
              <input type="radio" name="retention_type" className="accent-[var(--accent2)] w-4 h-4 cursor-pointer" defaultChecked />
              <span>{t.opt1}</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer text-sm">
              <input type="radio" name="retention_type" className="accent-[var(--accent2)] w-4 h-4 cursor-pointer" />
              <span>{t.opt2}</span>
            </label>
          </div>

          <div className="border border-[var(--line)] rounded-lg bg-[var(--panel)] p-5 mb-4 shadow-sm">
            <div className="text-[11px] text-[var(--muted)] uppercase tracking-wider font-bold mb-3">{t.termL}</div>
            <div className="flex gap-2 flex-wrap mb-3">
              {t.terms.map((x, i) => (
                <span key={i} className={`border rounded-full px-3 py-1 text-[11px] cursor-pointer transition-colors ${i === 1 ? 'bg-[var(--accentsoft)] border-[var(--accent)] text-[var(--accent)] font-semibold' : 'bg-[var(--panel)] border-[var(--line2)] text-[var(--ink)] hover:bg-[var(--soft)]'}`}>
                  {x}
                </span>
              ))}
            </div>
            <div className="text-xs text-[var(--muted)]">{t.termLeg}</div>
          </div>

          <div className="border border-[var(--line)] rounded-lg bg-[var(--panel)] p-5 shadow-sm">
            <div className="text-[11px] text-[var(--muted)] uppercase tracking-wider font-bold mb-3">{t.delL}</div>
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
                  <tr className="border-b border-[var(--line)] last:border-0 hover:bg-[var(--stat)] transition-colors">
                    <td className="p-3 text-[var(--ink)]">{t.delRow[0]}</td>
                    <td className="p-3 text-[var(--ink)]">{t.delRow[1]}</td>
                    <td className="p-3 text-right">
                      <button className="border border-[var(--line2)] bg-[var(--panel)] px-3 py-1.5 rounded-md text-xs font-semibold hover:bg-[var(--soft)] transition-colors">
                        {t.process}
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div className="mt-6 bg-[var(--note)] border border-[var(--noteline)] rounded-lg p-4 text-xs text-[var(--notetext)] leading-relaxed">
            <b className="font-bold">{d.noteUX}</b> {t.note}
          </div>

        </div>
      </div>
    </div>
  );
}