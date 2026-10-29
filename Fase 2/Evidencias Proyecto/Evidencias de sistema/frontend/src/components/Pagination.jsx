import Icon from './Icon';
import { cx } from './ui';
import { pageNumbers } from '../lib/practice/historyPaging';

// Paginación del historial: números (1 2 3 4 5 …) con la página activa marcada.
// Los huecos que devuelve `pageNumbers` se pintan como «…». Sin más de una página no se muestra nada.
export default function Pagination({ page, pages, onChange, className }) {
  if (pages <= 1) return null;
  const items = pageNumbers(pages, page);

  const arrow = 'h-9 w-9 rounded-lg flex items-center justify-center text-muted hover:bg-subtle disabled:opacity-40 disabled:pointer-events-none transition-colors';

  return (
    <nav className={cx('flex items-center justify-center gap-1 flex-wrap', className)} aria-label="Paginación del historial">
      <button type="button" className={arrow} onClick={() => onChange(page - 1)} disabled={page <= 1} aria-label="Página anterior">
        <Icon name="chevronLeft" size={16} />
      </button>

      {items.map((item, index) =>
        item === 'gap' ? (
          <span key={`gap-${index}`} className="px-1 text-sm text-faint" aria-hidden="true">
            …
          </span>
        ) : (
          <button
            key={item}
            type="button"
            onClick={() => onChange(item)}
            aria-current={item === page ? 'page' : undefined}
            className={cx(
              'h-9 min-w-9 px-2 rounded-lg text-sm tabular-nums transition-colors',
              item === page ? 'bg-primary text-primary-ink font-semibold' : 'text-ink hover:bg-subtle',
            )}
          >
            {item}
          </button>
        ),
      )}

      <button type="button" className={arrow} onClick={() => onChange(page + 1)} disabled={page >= pages} aria-label="Página siguiente">
        <Icon name="chevronRight" size={16} />
      </button>
    </nav>
  );
}
