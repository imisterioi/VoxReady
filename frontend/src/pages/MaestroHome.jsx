import I from '../data/dictionary';

export default function MaestroHome() {
  const d = I.es;
  const t = d.L.m1;
  const statValues = ['9', '640', '23', '88%']; // Valores del wireframe original

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
            master.voxready.io/panel
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

          <div className="flex flex-col lg:flex-row gap-4 mb-6">
            {/* Control de Versión */}
            <div className="flex-[1] border border-[var(--line)] rounded-lg bg-[var(--panel)] p-5">
              <div className="text-[11px] text-[var(--muted)] uppercase tracking-wider font-bold mb-3">{t.verL}</div>
              <div className="h-3 bg-[var(--barfill)] rounded-md w-3/4 mb-3"></div>
              <div className="text-xs text-[var(--muted)] mb-4">{t.verLeg}</div>
              <button className="border border-[var(--line2)] bg-[var(--panel)] px-4 py-2 rounded-md text-xs font-semibold hover:bg-[var(--soft)] transition-colors">
                {t.openRub}
              </button>
            </div>

            {/* Distribución Global (Placeholder visual) */}
            <div className="flex-[1] border border-[var(--line)] rounded-lg bg-[var(--panel)] p-5">
              <div className="text-[11px] text-[var(--muted)] uppercase tracking-wider font-bold mb-3">{t.distL}</div>
              <div className="h-[90px] rounded-md border border-dashed border-[var(--line2)] flex items-center justify-center text-xs text-[var(--muted)] bg-[var(--stat)]">
                {t.hist}
              </div>
            </div>
          </div>

          <div className="mt-5 bg-[var(--note)] border border-[var(--noteline)] rounded-lg p-4 text-xs text-[var(--notetext)] leading-relaxed">
            <b className="font-bold">{d.noteUX}</b> {t.note}
          </div>
        </div>
      </div>
    </div>
  );
}