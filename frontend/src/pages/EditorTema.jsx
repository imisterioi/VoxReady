import I from '../data/dictionary';
import toast from 'react-hot-toast';  

export default function EditorTema() {
  const d = I.es;
  const t = d.L.a2;

  // 1. Añade esta función aquí dentro de tu componente
  const handleSave = () => {
    toast.success('¡Tema guardado con éxito!');
  };

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
            admin.voxready.io/tema
          </div>
        </div>

        <div className="p-5 md:p-6">
          <div className="flex flex-col md:flex-row gap-6">
            
            {/* Columna Izquierda: Configuración Base */}
            <div className="flex-1">
              <div className="text-[11px] text-[var(--muted)] uppercase tracking-wider font-bold mb-1.5">{t.nameL}</div>
              <div className="h-[34px] border border-[var(--line)] rounded-md bg-[var(--panel)] px-3 flex items-center text-xs text-[var(--muted)] mb-4">
                {t.nameV}
              </div>

              <div className="text-[11px] text-[var(--muted)] uppercase tracking-wider font-bold mb-1.5">{t.ctxL}</div>
              <div className="min-h-[64px] border border-[var(--line)] rounded-md bg-[var(--panel)] p-3 text-xs text-[var(--muted)] mb-4">
                {t.ctxV}
              </div>

              <div className="text-[11px] text-[var(--muted)] uppercase tracking-wider font-bold mb-1.5">{t.opticL}</div>
              <div className="flex gap-2 flex-wrap mb-4">
                {t.optics.map((o, i) => (
                  <span key={i} className={`border rounded-full px-3 py-1 text-[11px] cursor-pointer transition-colors ${i === 0 ? 'bg-[var(--accentsoft)] border-[var(--accent)] text-[var(--accent)] font-semibold' : 'bg-[var(--panel)] border-[var(--line2)] text-[var(--ink)] hover:bg-[var(--soft)]'}`}>
                    {o}
                  </span>
                ))}
              </div>

              <div className="text-[11px] text-[var(--muted)] uppercase tracking-wider font-bold mb-1.5">{t.pubL}</div>
              <div className="flex gap-2 flex-wrap mb-4">
                {t.pubs.map((o, i) => (
                  <span key={i} className={`border rounded-full px-3 py-1 text-[11px] cursor-pointer transition-colors ${i === 0 ? 'bg-[var(--accentsoft)] border-[var(--accent)] text-[var(--accent)] font-semibold' : 'bg-[var(--panel)] border-[var(--line2)] text-[var(--ink)] hover:bg-[var(--soft)]'}`}>
                    {o}
                  </span>
                ))}
              </div>
            </div>

            {/* Columna Derecha: Mensajes y Reglas */}
            <div className="flex-1">
              <div className="text-[11px] text-[var(--muted)] uppercase tracking-wider font-bold mb-1.5">{t.keyL}</div>
              
              <div className="border border-[var(--line)] rounded-md bg-[var(--panel)] p-2 mb-2 flex justify-between items-center">
                <div className="h-2.5 bg-[var(--barfill)] rounded-sm w-3/4"></div>
                <span className="text-[var(--muted)] text-sm cursor-pointer hover:text-red-500">×</span>
              </div>
              <div className="border border-[var(--line)] rounded-md bg-[var(--panel)] p-2 mb-2 flex justify-between items-center">
                <div className="h-2.5 bg-[var(--barfill)] rounded-sm w-1/2"></div>
                <span className="text-[var(--muted)] text-sm cursor-pointer hover:text-red-500">×</span>
              </div>
              
              <button className="border border-transparent bg-transparent text-[var(--ink)] text-xs font-semibold hover:bg-[var(--soft)] px-3 py-1.5 rounded-md mb-5 transition-colors">
                {t.addMsg}
              </button>

              <div className="text-[11px] text-[var(--muted)] uppercase tracking-wider font-bold mb-1.5">{t.redL}</div>
              
              <div className="border border-[#e0a3a3] rounded-md bg-[var(--panel)] p-2 mb-2 flex justify-between items-center">
                <div className="h-2.5 bg-[var(--barfill)] rounded-sm w-3/4"></div>
                <span className="text-[var(--muted)] text-sm cursor-pointer hover:text-red-500">×</span>
              </div>
              
              <button className="border border-transparent bg-transparent text-[var(--ink)] text-xs font-semibold hover:bg-[var(--soft)] px-3 py-1.5 rounded-md transition-colors">
                {t.addRed}
              </button>
            </div>

          </div>

          {/* Botones */}
          <div className="flex gap-3 mt-6">
            {/* 2. Le añadimos onClick={handleSave} a este botón */}
            <button 
              onClick={handleSave}
              className="border border-[var(--accent2)] bg-[var(--accent2)] rounded-md px-5 py-2 text-xs text-white font-semibold hover:brightness-105 transition-all"
            >
              {t.save}
            </button>
            <button className="border border-[var(--line2)] bg-transparent px-5 py-2 rounded-md text-xs font-semibold text-[var(--ink)] hover:bg-[var(--soft)] transition-colors">
              {t.preview}
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