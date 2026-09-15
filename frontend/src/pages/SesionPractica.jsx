import { useNavigate } from 'react-router-dom';
import I from '../data/dictionary';

export default function SesionPractica() {
  const d = I.es;
  const t = d.L.u4;
  const navigate = useNavigate();

  return (
    <div className="animate-fade-in pb-10">
      <div className="text-xs text-[var(--muted)] mb-1">{t.crumbs}</div>
      <h2 className="text-2xl font-bold mb-1 text-[var(--ink)]">{t.title}</h2>
      <p className="text-sm text-[var(--muted)] mb-6">{t.sub}</p>

      <div className="bg-[var(--panel)] border border-[var(--line2)] rounded-lg overflow-hidden shadow-sm">
        
        {/* Barra del navegador */}
        <div className="flex items-center gap-2 px-3 py-2 bg-[var(--chrome2)] border-b border-[var(--line)]">
          <span className="w-2.5 h-2.5 rounded-full bg-[#ff5f56]"></span>
          <span className="w-2.5 h-2.5 rounded-full bg-[#ffbd2e]"></span>
          <span className="w-2.5 h-2.5 rounded-full bg-[#27c93f]"></span>
          <div className="flex-1 ml-2 bg-[var(--panel)] border border-[var(--line)] rounded-[5px] text-[11px] text-[var(--muted)] px-3 py-1">
            app.voxready.io/sesion/en-vivo
          </div>
        </div>

        <div className="p-5 md:p-6">
          
          {/* Vista Dividida 50/50 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
            
            {/* IA Entrevistador */}
            <div className="relative border border-[var(--line2)] rounded-lg min-h-[230px] md:min-h-[300px] bg-[#202830] flex items-center justify-center text-[13px] text-[#aab4bd] overflow-hidden shadow-inner">
              <div className="absolute top-2 left-2.5 bg-white/10 text-white text-[11px] px-2.5 py-1 rounded-md backdrop-blur-sm">
                {t.interviewer}
              </div>
              {t.interviewerV}
            </div>

            {/* Usuario (Self-view) */}
            <div className="relative border border-[var(--line2)] rounded-lg min-h-[230px] md:min-h-[300px] bg-[#323b43] flex items-center justify-center text-[13px] text-[#cdd4da] overflow-hidden shadow-inner">
              <div className="absolute top-2 right-2.5 flex items-center gap-1.5 bg-black/50 px-2.5 py-1 rounded-md text-white text-[11px] backdrop-blur-sm animate-pulse">
                <span className="w-2 h-2 rounded-full bg-[#e24b4a]"></span>
                REC 02:14
              </div>
              {t.selfV}
            </div>
            
          </div>

          {/* Subtítulos en vivo (Pregunta actual) */}
          <div className="border border-[var(--line)] rounded-lg bg-[var(--panel)] p-4 md:p-5 mb-5 border-l-4 border-l-[var(--accent2)] shadow-sm">
            <div className="text-[11px] text-[var(--muted)] uppercase tracking-wider font-bold mb-2">
              {t.qL}
            </div>
            <div className="text-base md:text-lg leading-relaxed text-[var(--ink)] font-medium">
              “{t.qEx}”
            </div>
          </div>

          {/* Controles de la sesión */}
          <div className="flex flex-wrap items-center gap-3">
            <button className="border border-[var(--line2)] bg-[var(--panel)] px-4 py-2 rounded-md text-xs font-semibold hover:bg-[var(--soft)] transition-colors">
              {t.pause}
            </button>
            <button className="border border-transparent bg-transparent px-4 py-2 rounded-md text-xs text-[var(--ink)] font-semibold hover:bg-[var(--soft)] transition-colors">
              {t.repeat}
            </button>
            
            <div className="hidden md:block flex-1 max-w-xs mx-4">
              <div className="h-2.5 rounded-[5px] bg-[var(--barfill)] overflow-hidden">
                <div className="h-full bg-[var(--accent)] w-[38%] rounded-r-[5px]"></div>
              </div>
            </div>
            
            <span className="text-xs text-[var(--muted)] whitespace-nowrap">
              {t.qn}
            </span>
            
            <button 
              onClick={() => navigate('/vocero/analizando')}
              className="ml-auto border border-[var(--accent2)] bg-[var(--accent2)] rounded-md px-5 py-2 text-xs text-white font-semibold hover:brightness-105 transition-all"
            >
              {t.finish}
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