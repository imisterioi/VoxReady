import { useState } from 'react';
import toast from 'react-hot-toast';
import I from '../data/dictionary';
import { CHARTDATA, CHARTCOLORS } from '../data/mockData';
import Icon from '../components/Icon';
import { Button, Card, CardHeader, PageHeader, cx } from '../components/ui';

export default function MiProgreso() {
  const d = I.es;
  const t = d.L.u7;

  // Calendario
  const today = new Date();
  const [calMonth, setCalMonth] = useState(today.getMonth());
  const [calYear, setCalYear] = useState(today.getFullYear());
  const [selectedDate, setSelectedDate] = useState(null);
  const [hovered, setHovered] = useState(null);

  // Gráfico SVG
  const W = 640, H = 240, pl = 32, pr = 12, pt = 16, pb = 28, n = CHARTDATA[0].length;
  const getX = (i) => Math.round(pl + (i * (W - pl - pr)) / (n - 1));
  const getY = (v) => Math.round(pt + ((100 - v) / (100 - 30)) * (H - pt - pb));

  const handlePrevMonth = () => {
    if (calMonth === 0) { setCalMonth(11); setCalYear(calYear - 1); }
    else setCalMonth(calMonth - 1);
  };
  const handleNextMonth = () => {
    if (calMonth === 11) { setCalMonth(0); setCalYear(calYear + 1); }
    else setCalMonth(calMonth + 1);
  };

  // Días reales del mes, semana comenzando en lunes
  const daysCount = new Date(calYear, calMonth + 1, 0).getDate();
  const offset = (new Date(calYear, calMonth, 1).getDay() + 6) % 7;
  const daysInMonth = Array.from({ length: daysCount }, (_, i) => i + 1);
  const isToday = (day) => day === today.getDate() && calMonth === today.getMonth() && calYear === today.getFullYear();
  const isPast = (day) => new Date(calYear, calMonth, day) < new Date(today.getFullYear(), today.getMonth(), today.getDate());

  const confirmDate = () => {
    toast.success(`Sesión agendada para el ${selectedDate.day} de ${t.months[selectedDate.month]}`);
  };

  return (
    <>
      <PageHeader eyebrow={t.eyebrow} title={t.title} description={t.sub} />

      {/* Resumen por área */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {t.series.map((s, i) => {
          const data = CHARTDATA[i];
          const current = data[data.length - 1];
          const change = current - data[0];
          return (
            <Card key={s} className="p-5">
              <div className="flex items-center gap-2 text-[13px] text-muted">
                <span className="h-2 w-2 rounded-full" style={{ background: CHARTCOLORS[i] }} />
                {s}
              </div>
              <div className="flex items-baseline gap-2 mt-3">
                <span className="text-[28px] font-semibold tracking-tight tabular-nums text-ink leading-none">{current}</span>
                <span className="text-xs font-medium text-success">▲ {change}</span>
              </div>
            </Card>
          );
        })}
      </div>

      {/* Gráfico */}
      <Card className="mb-6">
        <CardHeader
          title={t.trendL}
          description={t.trendSub}
          action={
            <div className="hidden sm:flex gap-4 flex-wrap">
              {t.series.map((s, i) => (
                <span key={s} className="text-xs text-muted flex items-center gap-1.5">
                  <span className="block w-3 h-[3px] rounded-full" style={{ background: CHARTCOLORS[i] }} />
                  {s}
                </span>
              ))}
            </div>
          }
        />
        <div className="w-full overflow-x-auto">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[480px] block" onMouseLeave={() => setHovered(null)}>
            {[40, 60, 80, 100].map((g) => (
              <g key={g}>
                <line x1={pl} y1={getY(g)} x2={W - pr} y2={getY(g)} stroke="rgb(var(--line))" strokeWidth="1" strokeDasharray={g === 100 ? '0' : '3 4'} />
                <text x={pl - 10} y={getY(g) + 3} fontSize="10" fill="rgb(var(--faint))" textAnchor="end">{g}</text>
              </g>
            ))}

            {hovered !== null && (
              <line x1={getX(hovered)} x2={getX(hovered)} y1={pt} y2={H - pb} stroke="rgb(var(--line-strong))" strokeWidth="1" />
            )}

            {CHARTDATA.map((series, si) => {
              const points = series.map((v, i) => `${getX(i)},${getY(v)}`).join(' ');
              return (
                <g key={si}>
                  <polyline points={points} fill="none" stroke={CHARTCOLORS[si]} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  {series.map((v, i) => (
                    <circle
                      key={i}
                      cx={getX(i)}
                      cy={getY(v)}
                      r={hovered === i ? 4.5 : i === n - 1 ? 3.5 : 0}
                      fill="rgb(var(--surface))"
                      stroke={CHARTCOLORS[si]}
                      strokeWidth="2"
                    />
                  ))}
                </g>
              );
            })}

            {/* Zonas de hover por sesión */}
            {Array.from({ length: n }).map((_, i) => (
              <rect
                key={i}
                x={getX(i) - (W - pl - pr) / (n - 1) / 2}
                y={pt}
                width={(W - pl - pr) / (n - 1)}
                height={H - pt - pb}
                fill="transparent"
                onMouseEnter={() => setHovered(i)}
              />
            ))}

            {Array.from({ length: n }).map((_, i) => (
              <text key={i} x={getX(i)} y={H - 8} fontSize="10" fill="rgb(var(--faint))" textAnchor="middle">
                Sesión {i + 1}
              </text>
            ))}
          </svg>
        </div>
        <div className="h-6 mt-2 text-xs text-muted flex flex-wrap gap-x-4">
          {hovered !== null &&
            t.series.map((s, i) => (
              <span key={s} className="tabular-nums">
                <span style={{ color: CHARTCOLORS[i] }}>●</span> {s}: <b className="text-ink font-medium">{CHARTDATA[i][hovered]}</b>
              </span>
            ))}
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recomendaciones */}
        <Card>
          <CardHeader title={t.recoTitle} description="Basadas en tus últimas sesiones" />
          <div className="space-y-3">
            {t.recos.map((r, i) => (
              <div key={r.t} className="flex gap-4 p-4 rounded-xl border border-line">
                <span className="h-7 w-7 rounded-full bg-subtle text-muted text-xs font-semibold flex items-center justify-center shrink-0">
                  {i + 1}
                </span>
                <div className="flex-1">
                  <div className="text-sm font-medium text-ink">{r.t}</div>
                  <div className="text-[13px] text-muted mt-1 leading-relaxed">{r.d}</div>
                  <Button variant="ghost" size="sm" to="/vocero/leccion" iconRight="arrowRight" className="mt-2 -ml-3">
                    {d.openLesson}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* Calendario */}
        <Card className="flex flex-col">
          <CardHeader title={t.calTitle} description={t.calHelp} />

          <div className="flex items-center justify-between mb-4">
            <span className="text-sm font-medium capitalize text-ink">
              {t.months[calMonth]} {calYear}
            </span>
            <div className="flex gap-1">
              <Button variant="ghost" size="icon" onClick={handlePrevMonth} aria-label="Mes anterior">
                <Icon name="chevronLeft" size={16} />
              </Button>
              <Button variant="ghost" size="icon" onClick={handleNextMonth} aria-label="Mes siguiente">
                <Icon name="chevronRight" size={16} />
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-7 gap-1 mb-1">
            {t.weekdays.map((w) => (
              <div key={w} className="text-[11px] font-medium text-faint text-center pb-2">{w}</div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: offset }).map((_, i) => <div key={`e-${i}`} />)}
            {daysInMonth.map((day) => {
              const isSelected = selectedDate?.day === day && selectedDate?.month === calMonth && selectedDate?.year === calYear;
              const past = isPast(day);
              return (
                <button
                  key={day}
                  disabled={past}
                  onClick={() => setSelectedDate({ day, month: calMonth, year: calYear })}
                  className={cx(
                    'relative h-10 rounded-lg text-[13px] tabular-nums transition-colors',
                    isSelected
                      ? 'bg-primary text-primary-ink font-semibold'
                      : past
                        ? 'text-faint/50 cursor-not-allowed'
                        : 'text-ink hover:bg-subtle',
                  )}
                >
                  {day}
                  {isToday(day) && !isSelected && <span className="absolute bottom-1.5 left-1/2 -translate-x-1/2 h-1 w-1 rounded-full bg-accent" />}
                </button>
              );
            })}
          </div>

          <div className="mt-auto pt-6 flex items-center justify-between gap-4 border-t border-line">
            <div>
              <div className="text-xs text-muted">{t.nextLabel}</div>
              <div className="text-sm font-medium text-ink mt-0.5">
                {selectedDate ? `${selectedDate.day} de ${t.months[selectedDate.month]}` : t.calNone}
              </div>
            </div>
            <Button disabled={!selectedDate} onClick={confirmDate} icon="calendar">
              {t.calBtn}
            </Button>
          </div>
        </Card>
      </div>
    </>
  );
}
