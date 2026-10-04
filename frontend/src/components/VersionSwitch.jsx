import { useLocation } from 'react-router-dom';
import { getCurrentUser } from '../lib/api';
import { legacyUrlFor } from '../demo/versions';
import { OPEN_DEMO_NOTICE } from './DemoNotice';
import { cx } from './ui';

// Triángulo amarillo de advertencia (relleno) para que el aviso de demo se note
function WarningTriangle() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" className="shrink-0">
      <path d="M10.3 3.6 1.9 18.2A2 2 0 0 0 3.6 21h16.8a2 2 0 0 0 1.7-2.8L13.7 3.6a2 2 0 0 0-3.4 0Z" fill="#F5B700" />
      <path d="M12 9v5" stroke="#2B2100" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="12" cy="17.4" r="1.25" fill="#2B2100" />
    </svg>
  );
}

// Switch flotante "Versión antigua / Versión nueva" (solo en la demo).
// Abre la pantalla equivalente del wireframe original con el mismo rol.
export default function VersionSwitch() {
  const { pathname } = useLocation();
  if (pathname.startsWith('/demo/')) return null;

  const goLegacy = () => {
    const user = pathname === '/login' ? null : getCurrentUser();
    window.location.assign(legacyUrlFor(pathname, user?.role));
  };

  const option = 'h-8 px-3.5 rounded-full text-[12.5px] font-medium transition-colors whitespace-nowrap';

  return (
    <div
      role="group"
      aria-label="Cambiar de versión"
      className="fixed bottom-4 left-4 z-[45] flex items-center gap-0.5 p-1 rounded-full border border-line bg-surface/95 backdrop-blur shadow-[0_12px_32px_-8px_rgb(15_27_42/0.28)]"
    >
      <button
        type="button"
        onClick={() => window.dispatchEvent(new Event(OPEN_DEMO_NOTICE))}
        title="Esta es una versión de demostración, no la versión final"
        aria-label="Versión de demostración: ver aviso"
        className={cx(option, 'inline-flex items-center gap-1.5 text-ink hover:bg-subtle')}
      >
        <WarningTriangle />
        Demo
      </button>
      <span className="h-5 w-px bg-line" aria-hidden="true" />
      <button type="button" onClick={goLegacy} className={cx(option, 'text-muted hover:text-ink hover:bg-subtle')}>
        Versión antigua
      </button>
      <button type="button" aria-pressed="true" className={cx(option, 'bg-accent text-accent-ink cursor-default')}>
        Versión nueva
      </button>
    </div>
  );
}
