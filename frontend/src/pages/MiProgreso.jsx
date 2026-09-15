import { useState } from 'react';
import I from '../data/dictionary';
import { CHARTDATA, CHARTCOLORS } from '../data/mockData';

export default function MiProgreso() {
  const d = I.es;
  const t = d.L.u7;
  
  // Estado para el calendario simulado
  const [calMonth, setCalMonth] = useState(new Date().getMonth());
  const [calYear, setCalYear] = useState(new Date().getFullYear());
  const [selectedDate, setSelectedDate] = useState(null);

  // Configuración del gráfico SVG
  const W = 600, H = 190, pl = 30, pr = 10, pt = 12, pb = 22, n = CHARTDATA[0].length;
  const getX = (i) => Math.round(pl + i * (W - pl - pr) / (n - 1));
  const getY = (v) => Math.round(pt + (100 - v) / (100 - 30) * (H - pt - pb));

  const handlePrevMonth = () => {
    if (calMonth === 0) { setCalMonth(11); setCalYear(calYear - 1); } 
    else { setCalMonth(calMonth - 1); }
  };

  const handleNextMonth = () => {
    if (calMonth === 11) { setCalMonth(0); setCalYear(calYear + 1); } 
    else { setCalMonth(calMonth + 1); }
  };

  // Días del mes (simplificado para el prototipo: asume 30 días y empieza en un offset fijo)
  const daysInMonth = Array.from({ length: 30 }, (_, i) => i + 1);
  const offsetDays = Array.from({ length: 2 }, (_, i) => i); // Espacios vacíos al inicio

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
            app.voxready.io/progreso
          </div>
        </div>

        <div className="p-5 md:p-6">
          
          {/* Fila 1: Gráfico y Tabla */}
          <div className="flex flex-col xl:flex-row gap-5 mb-5">
            
            {/* Gráfico de Tendencias */}
            <div className="flex-[1.5] border border-[var(--line)] rounded-lg bg-[var(--panel)] p-5">
              <div className="text-[11px] text-[var(--muted)] uppercase tracking-wider font-bold mb-4">{t.trendL}</div>
              
              <div className="w-full overflow-x-auto">
                <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[400px] block">
                  {/* Líneas base del grid */}
                  {[40, 60, 80].map(g => (
                    <g key={`grid-${g}`}>
                      <line x1={pl} y1={getY(g)} x2={W-pr} y2={getY(g)} stroke="var(--line)" strokeWidth="1" />
                      <text x="4" y={getY(g) + 3} fontSize="9" fill="var(--muted)">{g}</text>
                    </g>
                  ))}
                  
                  {/* Líneas de datos */}
                  {CHARTDATA.map((series, si) => {
                    const points = series.map((v, i) => `${getX(i)},${getY(v)}`).join(' ');
                    return (
                      <g key={`series-${si}`}>
                        <polyline points={points} fill="none" stroke={CHARTCOLORS[si]} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                        {series.map((v, i) => (
                          <circle key={`pt-${si}-${i}`} cx={getX(i)} cy={getY(v)} r="3" fill={CHARTCOLORS[si]} />
                        ))}
                      </g>
                    );
                  })}
                  
                  {/* Etiquetas X */}
                  {Array.from({length: n}).map((_, i) => (
                    <text key={`x-${i}`} x={getX(i)} y={H - 6} fontSize="9" fill="var(--muted)" textAnchor="middle">S{i + 1}</text>
                  ))}
                </svg>
              </div>

              {/* Leyenda */}
              <div className="flex gap-4 flex-wrap mt-4">
                {t.series.map((s, i) => (
                  <span key={i} className="text-[11px] text-[var(--muted)] flex items-center gap-1.5">
                    <span className="block w-2.5 h-2.5 rounded-[2px]" style={{ backgroundColor: CHARTCOLORS[i] }}></span>
                    {s}
                  </span>
                ))}
              </div>
            </div>

            {/* Tabla de Avance */}
            <div className="flex-1 border border-[var(--line)] rounded-lg bg-[var(--panel)] p-5">
              <div className="text-[11px] text-[var(--muted)] uppercase tracking-wider font-bold mb-3">{t.tblTitle}</div>
              <table className="w-full text-xs text-left border-collapse">
                <thead>
                  <tr className="bg-[var(--soft)] text-[var(--muted)]">
                    {t.tblCols.map((h, i) => (
                      <th key={i} className={`p-2 border border-[var(--line)] font-semibold ${i > 0 ? 'text-center' : ''}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {t.series.map((s, i) => {
                    const data = CHARTDATA[i];
                    const current = data[data.length - 1];
                    const change = current - data[0];
                    return (
                      <tr key={i}>
                        <td className="p-2 border border-[var(--line)] text-[var(--ink)] flex items-center gap-2">
                          <span className="block w-2 h-2 rounded-[2px]" style={{ backgroundColor: CHARTCOLORS[i] }}></span>
                          {s}
                        </td>
                        <td className="p-2 border border-[var(--line)] text-center font-bold text-[var(--ink)]">{current}</td>
                        <td className="p-2 border border-[var(--line)] text-center font-bold text-[#3b6d11]">▲ +{change}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Fila 2: Recomendaciones y Calendario */}
          <div className="flex flex-col lg:flex-row gap-5">
            
            {/* Recomendaciones */}
            <div className="flex-1 border border-[var(--line)] rounded-lg bg-[var(--panel)] p-5">
              <div className="text-[11px] text-[var(--muted)] uppercase tracking-wider font-bold mb-4">{t.recoTitle}</div>
              {t.recos.map((r, i) => (
                <div key={i} className="border border-[var(--line)] rounded-lg p-3 mb-2 bg-[var(--panel)]">
                  <div className="text-[13px] font-bold mb-1 text-[var(--ink)]">{r.t}</div>
                  <div className="text-xs text-[var(--muted)] mb-3 leading-relaxed">{r.d}</div>
                  <button className="border border-[var(--line2)] bg-transparent px-3 py-1.5 rounded-md text-xs font-semibold text-[var(--ink)] hover:bg-[var(--soft)] transition-colors">
                    {d.openLesson}
                  </button>
                </div>
              ))}
            </div>

            {/* Calendario */}
            <div className="flex-1 border border-[var(--line)] rounded-lg bg-[var(--panel)] p-5 flex flex-col">
              <div className="text-[11px] text-[var(--muted)] uppercase tracking-wider font-bold mb-1">{t.calTitle}</div>
              <div className="text-xs text-[var(--muted)] mb-4">{t.calHelp}</div>
              
              <div className="flex items-center justify-between mb-3">
                <button onClick={handlePrevMonth} className="px-2 py-1 border border-transparent rounded hover:bg-[var(--soft)] text-[var(--ink)] text-lg leading-none">‹</button>
                <span className="text-[13px] font-bold capitalize text-[var(--ink)]">{t.months[calMonth]} {calYear}</span>
                <button onClick={handleNextMonth} className="px-2 py-1 border border-transparent rounded hover:bg-[var(--soft)] text-[var(--ink)] text-lg leading-none">›</button>
              </div>

              <div className="grid grid-cols-7 gap-1 mb-1">
                {t.weekdays.map((w, i) => (
                  <div key={i} className="text-[10px] text-[var(--muted)] text-center pb-1">{w}</div>
                ))}
              </div>
              
              <div className="grid grid-cols-7 gap-1">
                {offsetDays.map(i => <div key={`empty-${i}`}></div>)}
                {daysInMonth.map(day => {
                  const isSelected = selectedDate?.day === day && selectedDate?.month === calMonth;
                  return (
                    <div 
                      key={day} 
                      onClick={() => setSelectedDate({ day, month: calMonth, year: calYear })}
                      className={`text-center py-1.5 rounded-md text-xs cursor-pointer border border-transparent transition-colors ${
                        isSelected 
                          ? 'bg-[var(--accent2)] text-white font-bold' 
                          : 'text-[var(--ink)] hover:bg-[var(--soft)]'
                      }`}
                    >
                      {day}
                    </div>
                  );
                })}
              </div>

              <div className="mt-auto pt-5 flex items-center justify-between">
                <span className="text-xs text-[var(--muted)]">
                  {t.nextLabel} <b className="text-[var(--accent2)]">
                    {selectedDate ? `${selectedDate.day} ${t.months[selectedDate.month]}` : t.calNone}
                  </b>
                </span>
                <button 
                  disabled={!selectedDate}
                  className={`border rounded-md px-4 py-2 text-xs font-semibold transition-all ${
                    selectedDate 
                      ? 'border-[var(--accent2)] bg-[var(--accent2)] text-white hover:brightness-105' 
                      : 'border-[var(--line2)] bg-[var(--panel)] text-[var(--ink)] opacity-50 cursor-not-allowed'
                  }`}
                >
                  {t.calBtn}
                </button>
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