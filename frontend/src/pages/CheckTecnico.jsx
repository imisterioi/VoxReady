import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import I from '../data/dictionary';

export default function CheckTecnico() {
  const d = I.es;
  const t = d.L.u3;
  const navigate = useNavigate();

  // Estados para los checkboxes de consentimiento
  const [check1, setCheck1] = useState(false);
  const [check2, setCheck2] = useState(false);

  // La sesión solo puede iniciar si ambos están marcados
  const canStart = check1 && check2;

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
            app.voxready.io/sesion/preparar
          </div>
        </div>

        <div className="p-5 md:p-6">
          <div className="flex flex-col md:flex-row gap-6">
            
            {/* Columna Izquierda: Cámara y Hardware */}
            <div className="flex-1 border border-[var(--line)] rounded-lg bg-[var(--panel)] p-5">
              <div className="text-[11px] text-[var(--muted)] uppercase tracking-wider font-bold mb-3">{t.camL}</div>
              
              {/* Contenedor de video (simulado) */}
              <div className="relative border border-[var(--line2)] rounded-lg min-h-[200px] bg-[#323b43] flex items-center justify-center text-[13px] text-[#cdd4da] overflow-hidden mb-4 shadow-inner">
                {t.camL}
                <div className="absolute top-2 right-2.5 flex items-center gap-1.5 bg-black/40 px-2.5 py-1 rounded-md text-white text-[11px]">
                  <span className="w-2 h-2 rounded-full bg-[#3b6d11]"></span>
                  {t.camOk}
                </div>
              </div>

              {/* Medidores de micrófono y luz */}
              <div>
                <div className="flex justify-between text-xs mb-1.5">
                  <span>{t.mic}</span>
                  <span className="text-[#3b6d11] font-medium">{t.micOk}</span>
                </div>
                <div className="h-2.5 rounded-[5px] bg-[var(--barfill)] overflow-hidden mb-4">
                  <div className="h-full bg-[#3b6d11] w-[60%] rounded-r-[5px]"></div>
                </div>

                <div className="flex justify-between text-xs mb-1.5">
                  <span>{t.light}</span>
                  <span className="text-[#b07d00] font-medium">{t.lightW}</span>
                </div>
                <div className="h-2.5 rounded-[5px] bg-[var(--barfill)] overflow-hidden">
                  <div className="h-full bg-[#ba7517] w-[45%] rounded-r-[5px]"></div>
                </div>
              </div>
            </div>

            {/* Columna Derecha: Consentimiento Legal */}
            <div className="flex-1 border border-[var(--line)] rounded-lg bg-[var(--panel)] p-5 flex flex-col">
              <div className="text-[11px] text-[var(--muted)] uppercase tracking-wider font-bold mb-3">{t.consentL}</div>
              
              <div className="border border-[var(--line)] rounded-md bg-[var(--panel)] min-h-[110px] p-4 text-xs text-[var(--muted)] mb-5">
                {t.legal}
              </div>

              <label className="flex items-start gap-2.5 mb-3 cursor-pointer group">
                <input 
                  type="checkbox" 
                  className="mt-0.5 w-4 h-4 accent-[var(--accent2)] shrink-0 cursor-pointer" 
                  checked={check1}
                  onChange={(e) => setCheck1(e.target.checked)}
                />
                <span className="text-xs group-hover:text-[var(--accent)] transition-colors">{t.chk1}</span>
              </label>

              <label className="flex items-start gap-2.5 mb-5 cursor-pointer group">
                <input 
                  type="checkbox" 
                  className="mt-0.5 w-4 h-4 accent-[var(--accent2)] shrink-0 cursor-pointer" 
                  checked={check2}
                  onChange={(e) => setCheck2(e.target.checked)}
                />
                <span className="text-xs group-hover:text-[var(--accent)] transition-colors">{t.chk2}</span>
              </label>

              {/* Botones de acción */}
              <div className="mt-auto">
                <div className="flex gap-3 mb-2">
                  <button 
                    onClick={() => navigate('/vocero/sesion')}
                    disabled={!canStart}
                    className={`px-4 py-2 text-xs font-semibold rounded-md transition-all border ${
                      canStart 
                        ? 'bg-[var(--accent2)] border-[var(--accent2)] text-white hover:brightness-105 cursor-pointer' 
                        : 'bg-[var(--panel)] border-[var(--line2)] text-[var(--ink)] opacity-40 cursor-not-allowed'
                    }`}
                  >
                    {t.beginBtn}
                  </button>
                  <button 
                    onClick={() => navigate('/vocero/escenarios')}
                    className="px-4 py-2 text-xs font-semibold rounded-md border border-transparent bg-transparent text-[var(--ink)] hover:bg-[var(--soft)] transition-colors"
                  >
                    {t.cancel}
                  </button>
                </div>
                <div className="text-[11px] text-[var(--muted)]">{t.sesLang}</div>
              </div>
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