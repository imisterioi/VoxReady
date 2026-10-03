import { useState } from 'react';
import toast from 'react-hot-toast';
import Icon from './Icon';
import { cx } from './ui';
import { saveOrgPalette } from '../lib/branding';
import { PRESETS, effectivePalette, samePalette, setPreviewPalette, usePalette } from '../lib/palette';

// Colores de muestra del header (como en el wireframe original).
// mode="org"   → administrador del cliente: guarda la paleta de su organización
//                (la verán todos sus voceros).
// mode="local" → login y personal de VoxReady: vista previa que se recuerda en este navegador.
export default function PaletteSwatches({ mode = 'local', className }) {
  const state = usePalette();
  const current = effectivePalette(state);
  const [saving, setSaving] = useState(false);

  const choose = async (p) => {
    if (mode !== 'org') return setPreviewPalette(p);
    if (saving || (current && samePalette(current, p))) return;
    try {
      setSaving(true);
      await saveOrgPalette(p);
      toast.success(`Paleta ${p.name} guardada para tu organización`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={cx('items-center gap-2', className)} role="group" aria-label="Colores de muestra">
      <span className="text-xs text-muted" title={mode === 'org' ? 'Se aplica a todos los voceros de tu organización' : undefined}>
        Paleta
      </span>
      <div className="flex items-center gap-1.5">
        {PRESETS.slice(0, 4).map((p) => {
          const active = current ? samePalette(current, p) : p.id === 'voxready';
          return (
            <button
              key={p.id}
              type="button"
              title={mode === 'org' ? `${p.name} (se guarda para tu organización)` : p.name}
              aria-label={`Paleta ${p.name}`}
              aria-pressed={active}
              disabled={saving}
              onClick={() => choose(p)}
              className={cx(
                'h-5 w-5 rounded-full ring-offset-2 ring-offset-canvas transition-shadow disabled:opacity-60',
                active ? 'ring-2 ring-ink' : 'hover:ring-2 hover:ring-line-strong',
              )}
              style={{ background: `linear-gradient(135deg, ${p.brand} 50%, ${p.accent} 50%)` }}
            />
          );
        })}
      </div>
      {mode === 'local' && state.preview && (
        <button
          type="button"
          onClick={() => setPreviewPalette(null)}
          title="Volver a los colores de VoxReady"
          aria-label="Volver a los colores de VoxReady"
          className="h-6 w-6 rounded-md flex items-center justify-center text-muted hover:text-ink hover:bg-subtle"
        >
          <Icon name="refresh" size={13} />
        </button>
      )}
    </div>
  );
}
