import toast from 'react-hot-toast';
import Icon from './Icon';
import { cx } from './ui';

// Aviso destacado en la parte superior (informe listo, revisión de un experto…).
// Es mucho más visible que un toast normal: tarjeta ancha con el color de acento, icono con pulso,
// título grande, botón de acción y cierre. Dura 20 s (o hasta que se use o se cierre).
export function showLiveNotice({ id, icon = 'sparkles', title, message, actionLabel, onAction, closeLabel }) {
  return toast.custom(
    (shown) => (
      <div
        role="status"
        aria-live="polite"
        className={cx(
          'pointer-events-auto w-[min(560px,calc(100vw-32px))] rounded-2xl bg-primary text-primary-ink shadow-2xl ring-1 ring-black/10 overflow-hidden transition-all duration-300',
          shown.visible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-3',
        )}
      >
        <div className="h-1.5 bg-accent" />
        <div className="flex items-center gap-4 p-4 md:p-5">
          <span className="relative shrink-0 h-12 w-12">
            <span className="absolute inset-0 rounded-full bg-accent/40 animate-ping" />
            <span className="relative h-12 w-12 rounded-full bg-accent text-white flex items-center justify-center">
              <Icon name={icon} size={22} strokeWidth={2} />
            </span>
          </span>
          <div className="flex-1 min-w-0">
            <div className="font-display text-[17px] md:text-[18px] font-semibold leading-tight">{title}</div>
            {message && <p className="text-[13.5px] opacity-80 mt-1 leading-snug">{message}</p>}
          </div>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 shrink-0">
            {actionLabel && (
              <button
                type="button"
                className="h-10 px-4 rounded-xl bg-accent text-white text-sm font-semibold hover:brightness-110 transition"
                onClick={() => {
                  toast.dismiss(shown.id);
                  onAction?.();
                }}
              >
                {actionLabel}
              </button>
            )}
            <button
              type="button"
              aria-label={closeLabel}
              title={closeLabel}
              className="h-10 w-10 self-center rounded-xl hover:bg-white/10 flex items-center justify-center opacity-70 hover:opacity-100 transition"
              onClick={() => toast.dismiss(shown.id)}
            >
              <Icon name="x" size={18} />
            </button>
          </div>
        </div>
      </div>
    ),
    { id, position: 'top-center', duration: 20000 },
  );
}
