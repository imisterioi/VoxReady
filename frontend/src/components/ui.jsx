import { Link } from 'react-router-dom';
import Icon from './Icon';

const cx = (...c) => c.filter(Boolean).join(' ');

/* ---------------------------------------------------------------- Botón */

const BTN_VARIANTS = {
  primary: 'bg-primary text-primary-ink hover:bg-primary/90 shadow-sm',
  accent: 'bg-accent text-white hover:bg-accent/90 shadow-sm shadow-accent/20',
  secondary: 'bg-surface text-ink border border-line hover:border-line-strong hover:bg-subtle',
  ghost: 'text-muted hover:text-ink hover:bg-subtle',
  danger: 'bg-danger/10 text-danger hover:bg-danger/15',
};

const BTN_SIZES = {
  sm: 'h-8 px-3 text-[13px] gap-1.5 rounded-lg',
  md: 'h-10 px-4 text-sm gap-2 rounded-lg',
  lg: 'h-12 px-6 text-[15px] gap-2 rounded-xl',
  icon: 'h-9 w-9 rounded-lg justify-center',
};

export function Button({ variant = 'primary', size = 'md', icon, iconRight, to, className, children, ...rest }) {
  const classes = cx(
    'inline-flex items-center justify-center font-medium whitespace-nowrap transition-all duration-150',
    'disabled:opacity-40 disabled:pointer-events-none active:scale-[0.98]',
    BTN_VARIANTS[variant],
    BTN_SIZES[size],
    className,
  );
  const content = (
    <>
      {icon && <Icon name={icon} size={size === 'lg' ? 18 : 16} />}
      {children}
      {iconRight && <Icon name={iconRight} size={size === 'lg' ? 18 : 16} />}
    </>
  );
  if (to) return <Link to={to} className={classes} {...rest}>{content}</Link>;
  return <button type="button" className={classes} {...rest}>{content}</button>;
}

/* --------------------------------------------------------------- Tarjeta */

export function Card({ as: Tag = 'div', className, padded = true, children, ...rest }) {
  return (
    <Tag className={cx('rounded-2xl border border-line bg-surface', padded && 'p-6', className)} {...rest}>
      {children}
    </Tag>
  );
}

export function CardHeader({ title, description, action, className }) {
  return (
    <div className={cx('flex items-start justify-between gap-4 mb-5', className)}>
      <div className="min-w-0">
        <h3 className="text-[15px] font-semibold text-ink tracking-tight">{title}</h3>
        {description && <p className="text-[13px] text-muted mt-1 leading-relaxed">{description}</p>}
      </div>
      {action}
    </div>
  );
}

/* ------------------------------------------------------ Encabezado página */

export function PageHeader({ eyebrow, title, description, actions, className }) {
  return (
    <header className={cx('flex flex-col md:flex-row md:items-end md:justify-between gap-5 mb-10', className)}>
      <div className="max-w-2xl">
        {eyebrow && <div className="eyebrow mb-3">{eyebrow}</div>}
        <h1 className="font-display font-semibold text-[32px] md:text-[40px] leading-[1.15] tracking-[-0.025em] text-ink">{title}</h1>
        {description && <p className="text-[15px] text-muted mt-3 leading-relaxed">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>}
    </header>
  );
}

/* ------------------------------------------------------------ Métricas */

export function Stat({ label, value, hint, trend, icon }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-5">
      <div className="flex items-center justify-between text-muted">
        <span className="text-[13px]">{label}</span>
        {icon && <Icon name={icon} size={16} className="text-faint" />}
      </div>
      <div className="mt-3 flex items-baseline gap-2">
        <span className="text-[32px] font-semibold tracking-tight text-ink leading-none tabular-nums">{value}</span>
        {trend && <span className="text-xs font-medium text-success">{trend}</span>}
      </div>
      {hint && <div className="text-xs text-faint mt-2">{hint}</div>}
    </div>
  );
}

/* ---------------------------------------------------------------- Badge */

const BADGE_TONES = {
  neutral: 'bg-subtle text-muted',
  accent: 'bg-accent-soft text-accent',
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/10 text-warning',
  danger: 'bg-danger/10 text-danger',
  outline: 'border border-line text-muted',
};

export function Badge({ tone = 'neutral', icon, className, children }) {
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-full px-2.5 h-6 text-xs font-medium', BADGE_TONES[tone], className)}>
      {icon && <Icon name={icon} size={12} strokeWidth={2} />}
      {children}
    </span>
  );
}

/* -------------------------------------------------- Selector de opciones */

export function Segmented({ options, value, onChange, className }) {
  return (
    <div className={cx('inline-flex flex-wrap p-1 rounded-xl bg-subtle gap-1', className)}>
      {options.map((opt) => {
        const val = typeof opt === 'string' ? opt : opt.value;
        const label = typeof opt === 'string' ? opt : opt.label;
        const active = val === value;
        return (
          <button
            key={val}
            type="button"
            onClick={() => onChange(val)}
            className={cx(
              'h-8 px-3.5 rounded-lg text-[13px] font-medium transition-all',
              active ? 'bg-surface text-ink shadow-soft' : 'text-muted hover:text-ink',
            )}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

export function ChoiceChips({ options, value, onChange, multiple = false }) {
  const isActive = (o) => (multiple ? value.includes(o) : value === o);
  const toggle = (o) => {
    if (!multiple) return onChange(o);
    onChange(isActive(o) ? value.filter((v) => v !== o) : [...value, o]);
  };
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          onClick={() => toggle(o)}
          className={cx(
            'h-9 px-4 rounded-full text-[13px] font-medium border transition-all inline-flex items-center gap-1.5',
            isActive(o)
              ? 'bg-primary text-primary-ink border-primary'
              : 'bg-surface text-muted border-line hover:border-line-strong hover:text-ink',
          )}
        >
          {isActive(o) && <Icon name="check" size={13} strokeWidth={2.5} />}
          {o}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------ Barra progreso */

export function Progress({ value, tone = 'accent', className, height = 'h-1.5' }) {
  const tones = { accent: 'bg-accent', ink: 'bg-ink', success: 'bg-success', brand: 'bg-brand' };
  return (
    <div className={cx('w-full rounded-full bg-subtle overflow-hidden', height, className)}>
      <div
        className={cx('h-full rounded-full transition-[width] duration-500 ease-out', tones[tone])}
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
}

/* ------------------------------------------------------ Anillo de puntaje */

export function ScoreRing({ value, size = 140, stroke = 10, label = '/100' }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgb(var(--subtle))" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="rgb(var(--accent))"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - value / 100)}
          style={{ transition: 'stroke-dashoffset 1s ease-out' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-display font-semibold text-[40px] leading-none tracking-[-0.03em] text-ink tabular-nums">{value}</span>
        <span className="text-xs text-faint mt-1">{label}</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- Campos */

export function Field({ label, hint, children, className }) {
  return (
    <div className={className}>
      {label && <label className="label">{label}</label>}
      {children}
      {hint && <p className="text-xs text-faint mt-1.5 leading-relaxed">{hint}</p>}
    </div>
  );
}

export function Checkbox({ checked, onChange, children }) {
  return (
    <label className="flex items-start gap-3 cursor-pointer group select-none">
      <span
        className={cx(
          'mt-0.5 h-5 w-5 rounded-md border flex items-center justify-center transition-all shrink-0',
          checked ? 'bg-primary border-primary text-primary-ink' : 'bg-surface border-line-strong group-hover:border-muted',
        )}
      >
        {checked && <Icon name="check" size={13} strokeWidth={3} />}
      </span>
      <input type="checkbox" className="sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="text-sm text-ink leading-relaxed">{children}</span>
    </label>
  );
}

export function Radio({ checked, onChange, title, description }) {
  return (
    <label
      className={cx(
        'flex items-start gap-3 p-4 rounded-xl border cursor-pointer transition-all',
        checked ? 'border-ink/60 bg-subtle/60' : 'border-line hover:border-line-strong',
      )}
    >
      <span
        className={cx(
          'mt-0.5 h-5 w-5 rounded-full border flex items-center justify-center shrink-0 transition-all',
          checked ? 'border-primary' : 'border-line-strong',
        )}
      >
        {checked && <span className="h-2.5 w-2.5 rounded-full bg-primary" />}
      </span>
      <input type="radio" className="sr-only" checked={checked} onChange={onChange} />
      <span>
        <span className="block text-sm font-medium text-ink">{title}</span>
        {description && <span className="block text-[13px] text-muted mt-0.5 leading-relaxed">{description}</span>}
      </span>
    </label>
  );
}

/* --------------------------------------------------------- Estado vacío */

export function EmptyState({ icon = 'info', title, description, action, tone = 'neutral' }) {
  return (
    <div className="flex flex-col items-center text-center py-16 px-6">
      <div
        className={cx(
          'h-12 w-12 rounded-2xl flex items-center justify-center mb-4',
          tone === 'danger' ? 'bg-danger/10 text-danger' : 'bg-subtle text-muted',
        )}
      >
        <Icon name={icon} size={22} />
      </div>
      <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
      {description && <p className="text-sm text-muted mt-1.5 max-w-sm leading-relaxed">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/* ------------------------------------------------------------- Avatar */

export function Avatar({ initials, size = 'md' }) {
  const s = size === 'sm' ? 'h-7 w-7 text-[11px]' : size === 'lg' ? 'h-11 w-11 text-sm' : 'h-9 w-9 text-xs';
  return (
    <span className={cx('rounded-full bg-brand text-white dark:text-canvas font-semibold flex items-center justify-center shrink-0', s)}>
      {initials}
    </span>
  );
}

/* ---------------------------------------------------- Tabla minimalista */

export function Table({ columns, children }) {
  return (
    <div className="overflow-x-auto -mx-6">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-y border-line">
            {columns.map((c, i) => (
              <th
                key={i}
                className={cx(
                  'py-3 px-6 text-left text-xs font-medium text-muted whitespace-nowrap',
                  c.align === 'right' && 'text-right',
                )}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
    </div>
  );
}

export { cx };
