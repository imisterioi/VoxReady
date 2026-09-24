import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import I from '../data/dictionary';
import Icon from '../components/Icon';
import PracticeSteps from '../components/PracticeSteps';
import { Button, Card, cx } from '../components/ui';

export default function Analizando() {
  const t = I.es.L.u5;
  const navigate = useNavigate();
  const steps = [
    { label: t.p1, icon: 'file' },
    { label: t.p2, icon: 'mic' },
    { label: t.p3, icon: 'person' },
    { label: t.p4, icon: 'sparkles' },
  ];

  // Avance visual de los pasos (el análisis real es asíncrono en el backend)
  const [current, setCurrent] = useState(0);
  useEffect(() => {
    if (current >= steps.length) return;
    const id = setTimeout(() => setCurrent((c) => c + 1), 1400);
    return () => clearTimeout(id);
  }, [current, steps.length]);

  const done = current >= steps.length;

  return (
    <>
      <PracticeSteps />

      <div className="flex justify-center">
        <Card className="w-full max-w-xl p-8 md:p-12 text-center">
          <div className="relative h-20 w-20 mx-auto mb-8">
            {!done && <span className="absolute inset-0 rounded-full border-2 border-subtle border-t-accent animate-spin" />}
            <span
              className={cx(
                'absolute rounded-full flex items-center justify-center transition-colors',
                done ? 'inset-0 bg-success/10 text-success' : 'inset-2 bg-accent-soft text-accent',
              )}
            >
              <Icon name={done ? 'check' : 'sparkles'} size={done ? 30 : 24} strokeWidth={done ? 2.5 : 1.75} />
            </span>
          </div>

          <h1 className="font-display font-semibold text-[28px] leading-tight tracking-[-0.025em] text-ink">{done ? 'Tu informe está listo' : t.head}</h1>
          <p className="text-sm text-muted mt-2">{done ? 'Revisa tus resultados y recomendaciones.' : t.small}</p>

          <ul className="mt-10 space-y-1 text-left">
            {steps.map((s, i) => {
              const state = i < current ? 'done' : i === current ? 'active' : 'pending';
              return (
                <li
                  key={s.label}
                  className={cx(
                    'flex items-center gap-4 rounded-xl px-4 h-14 transition-all',
                    state === 'active' && 'bg-subtle',
                    state === 'pending' && 'opacity-40',
                  )}
                >
                  <span
                    className={cx(
                      'h-8 w-8 rounded-lg flex items-center justify-center',
                      state === 'done' ? 'bg-success/10 text-success' : state === 'active' ? 'bg-accent-soft text-accent' : 'bg-subtle text-faint',
                    )}
                  >
                    <Icon name={state === 'done' ? 'check' : s.icon} size={15} strokeWidth={state === 'done' ? 2.5 : 1.75} />
                  </span>
                  <span className={cx('text-sm flex-1', state === 'pending' ? 'text-muted' : 'text-ink font-medium')}>{s.label}</span>
                  {state === 'active' && <span className="h-4 w-4 rounded-full border-2 border-line border-t-accent animate-spin" />}
                </li>
              );
            })}
          </ul>

          <Button variant={done ? 'accent' : 'primary'} size="lg" iconRight="arrowRight" className="mt-10 w-full sm:w-auto" onClick={() => navigate('/vocero/informe')}>
            {t.cta}
          </Button>
        </Card>
      </div>
    </>
  );
}
