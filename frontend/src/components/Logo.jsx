// Logo de VoxReady.
// tone="auto"    → se adapta al tema claro/oscuro (uso general)
// tone="inverse" → para fondos oscuros fijos (panel de marca del login)
export default function Logo({ className = '', showText = true, tone = 'auto' }) {
  const inverse = tone === 'inverse';

  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <svg viewBox="0 0 32 32" className="h-8 w-8 shrink-0" aria-hidden="true">
        <rect width="32" height="32" rx="9" className={inverse ? 'fill-white' : 'fill-brand dark:fill-ink'} />
        <path
          d="M9 9l7 14 7-14"
          fill="none"
          className={inverse ? 'stroke-[#17354F]' : 'stroke-white dark:stroke-canvas'}
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path d="M22.5 8.5c2 1.6 3 3.8 3 6.5" fill="none" stroke="rgb(var(--accent))" strokeWidth="2.4" strokeLinecap="round" />
      </svg>
      {showText && (
        <span className={`font-display text-[17px] font-bold tracking-[-0.02em] ${inverse ? 'text-white' : 'text-ink'}`}>
          Vox<span className={inverse ? 'text-[#F08046]' : 'text-accent'}>Ready</span>
        </span>
      )}
    </span>
  );
}
