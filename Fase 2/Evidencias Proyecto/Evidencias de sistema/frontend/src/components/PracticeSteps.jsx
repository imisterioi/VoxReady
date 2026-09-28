import { Link, useLocation } from 'react-router-dom';
import I from '../data/dictionary';
import Icon from './Icon';
import { cx } from './ui';

// Indicador del flujo de práctica: escenario → preparación → entrevista → análisis → informe.
export default function PracticeSteps({ className }) {
  const { pathname } = useLocation();
  const steps = I.es.flow;
  const current = steps.findIndex((s) => pathname.startsWith(s.to));

  return (
    <nav aria-label="Pasos de la práctica" className={cx('mb-10 overflow-x-auto', className)}>
      <ol className="flex items-center gap-2 min-w-max">
        {steps.map((s, i) => {
          const done = i < current;
          const active = i === current;
          return (
            <li key={s.to} className="flex items-center gap-2">
              <Link
                to={s.to}
                className={cx(
                  'flex items-center gap-2 h-8 pl-1 pr-3 rounded-full text-[13px] font-medium transition-colors',
                  active ? 'bg-primary text-primary-ink' : done ? 'text-ink hover:bg-subtle' : 'text-faint hover:text-muted',
                )}
                aria-current={active ? 'step' : undefined}
              >
                <span
                  className={cx(
                    'h-6 w-6 rounded-full flex items-center justify-center text-[11px] font-semibold',
                    active ? 'bg-primary-ink/15' : done ? 'bg-success/15 text-success' : 'bg-subtle',
                  )}
                >
                  {done ? <Icon name="check" size={12} strokeWidth={3} /> : i + 1}
                </span>
                {s.label}
              </Link>
              {i < steps.length - 1 && <span className={cx('h-px w-6', i < current ? 'bg-success/40' : 'bg-line')} />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
