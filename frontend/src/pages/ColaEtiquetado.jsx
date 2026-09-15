import I from '../data/dictionary';

export default function ColaEtiquetado() {
  const d = I.es;
  const t = d.L.m3;
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
            master.voxready.io/etiquetado
          </div>
        </div>

        <div className="p-5 md:p-6 flex flex-col md:flex-row gap-6">
          
          {/* Cola Lateral */}
          <div className="w-full md:w-56 shrink-0">
            <div className="text-[11px] text-[var(--muted)] uppercase tracking-wider font-bold mb-3">{t.queueL}</div>
            <div className="border border-[var(--line)] rounded-lg bg-[var(--panel)] p-3 mb-2 border-l-4 border-l-[var(--accent2)] shadow-sm">
              <div className="h-2 bg-[var(--barfill)] rounded-sm w-1/2 mb-2"></div>
              <span className="text-[11px] text-[var(--muted)]">{t.q1}</span>
            </div>
            <div className="border border-[var(--line)] rounded-lg bg-[var(--panel)] p-3 mb-2 hover:bg-[var(--soft)] cursor-pointer transition-colors">
              <div className="h-2 bg-[var(--barfill)] rounded-sm w-1/2 mb-2"></div>
              <span className="text-[11px] text-[var(--muted)]">{t.q2}</span>
            </div>
            <div className="border border-[var(--line)] rounded-lg bg-[var(--panel)] p-3 hover:bg-[var(--soft)] cursor-pointer transition-colors">
              <div className="h-2 bg-[var(--barfill)] rounded-sm w-1/2 mb-2"></div>
              <span className="text-[11px] text-[var(--muted)]">{t.q3}</span>
            </div>
          </div>

          {/* Panel Principal del Caso */}
          <div className="flex-1 border border-[var(--line)] rounded-lg p-5 bg-[var(--panel)] shadow-sm">
            <div className="text-[11px] text-[var(--muted)] uppercase tracking-wider font-bold mb-4">{t.caseL}</div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
              <div className="relative border border-[var(--line2)] rounded-lg min-h-[140px] bg-[#202830] flex items-center justify-center text-[13px] text-[#aab4bd]">
                {t.rec}
              </div>
              <div className="bg-[var(--stat)] border border-[var(--line)] rounded-lg p-4">
                <div className="text-[11px] text-[var(--muted)] mb-3">{t.proposal}</div>
                {t.areas.map((n, i) => (
                  <div key={i} className="flex justify-between items-center text-xs mb-2">
                    <span className="text-[var(--ink)]">{n}</span>
                    <span className="font-bold text-[var(--accent)] flex items-center gap-2">
                      {areaScores[i]} 
                      <input type="text" defaultValue={areaScores[i]} className="w-10 border border-[var(--line)] rounded-md px-1.5 py-0.5 bg-[var(--panel)] text-[var(--ink)] font-normal text-center" />
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="text-[11px] text-[var(--muted)] uppercase tracking-wider font-bold mb-2">{t.commentL}</div>
            <textarea className="w-full min-h-[60px] border border-[var(--line)] rounded-md bg-[var(--panel)] p-3 text-xs text-[var(--ink)] mb-4 resize-y focus:outline-none focus:border-[var(--accent)]"></textarea>

            <div className="flex gap-3">
              <button className="border border-[var(--accent2)] bg-[var(--accent2)] rounded-md px-5 py-2 text-xs text-white font-semibold hover:brightness-105 transition-all">
                {t.confirm}
              </button>
              <button className="border border-[var(--line2)] bg-transparent px-5 py-2 rounded-md text-xs font-semibold text-[var(--ink)] hover:bg-[var(--soft)] transition-colors">
                {t.skip}
              </button>
            </div>
            
            <div className="mt-5 bg-[var(--note)] border border-[var(--noteline)] rounded-lg p-4 text-xs text-[var(--notetext)] leading-relaxed">
              <b className="font-bold">{d.noteUX}</b> {t.note}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}