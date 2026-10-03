import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import Icon from '../components/Icon';
import Logo from '../components/Logo';
import { Avatar, Badge, Button, Card, CardHeader, EmptyState, Field, PageHeader, Progress, ScoreRing, cx } from '../components/ui';
import useApiData from '../hooks/useApiData';
import { saveOrgPalette } from '../lib/branding';
import {
  DEFAULT_PALETTE,
  PRESETS,
  isHex,
  normalizePalette,
  paletteWarnings,
  presetFor,
  samePalette,
  setDraftPalette,
} from '../lib/palette';

// Estilo de la organización (GET/PUT /api/tenant/branding): el administrador del
// cliente elige los colores con los que sus voceros ven la plataforma.
export default function Estilo() {
  const branding = useApiData('/api/tenant/branding');
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);

  const saved = normalizePalette({ brand: branding.data?.branding?.brandColor, accent: branding.data?.branding?.accentColor }) || DEFAULT_PALETTE;

  useEffect(() => {
    if (branding.data) setForm(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branding.data]);

  // Vista previa en vivo de toda la plataforma mientras se edita
  useEffect(() => {
    if (form) setDraftPalette(normalizePalette(form));
  }, [form]);
  useEffect(() => () => setDraftPalette(null), []);

  if (branding.error) {
    return (
      <Card>
        <EmptyState tone="danger" icon="server" title="No se pudo cargar el estilo" description={branding.error} />
      </Card>
    );
  }
  if (!form) {
    return (
      <Card>
        <EmptyState icon="refresh" title="Cargando estilo…" />
      </Card>
    );
  }

  const valid = isHex(form.brand) && isHex(form.accent);
  const changed = valid && !samePalette(form, saved);
  const warnings = paletteWarnings(form);
  const activePreset = valid ? presetFor(form) : null;

  const save = async (palette) => {
    try {
      setSaving(true);
      const { isDefault } = await saveOrgPalette(palette);
      setForm(normalizePalette(palette));
      branding.reload();
      toast.success(isDefault ? 'Se restablecieron los colores de VoxReady' : 'Estilo guardado para tu organización');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const setColor = (key, value) => setForm((f) => ({ ...f, [key]: value.startsWith('#') ? value : `#${value}` }));

  return (
    <>
      <PageHeader
        eyebrow="Configuración"
        title="Estilo"
        description={`Elige los colores con los que ${branding.data?.branding?.name || 'tu organización'} verá VoxReady. Se aplican a todos tus voceros.`}
        actions={
          <>
            <Button variant="secondary" icon="refresh" onClick={() => setForm(saved)} disabled={!changed || saving}>
              Descartar cambios
            </Button>
            <Button icon="check" onClick={() => save(form)} disabled={!changed || saving}>
              {saving ? 'Guardando…' : 'Guardar estilo'}
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-[1.3fr_1fr] gap-6">
        <div className="space-y-6">
          {/* Paletas sugeridas */}
          <Card>
            <CardHeader title="Paletas sugeridas" description="Combinaciones probadas para que los textos y botones se lean bien en modo claro y oscuro." />
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {PRESETS.map((p) => {
                const active = activePreset?.id === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setForm({ brand: p.brand, accent: p.accent })}
                    aria-pressed={active}
                    className={cx(
                      'rounded-xl border p-3 text-left transition-all',
                      active ? 'border-ink ring-2 ring-ink/10' : 'border-line hover:border-line-strong',
                    )}
                  >
                    <div className="flex h-10 rounded-lg overflow-hidden">
                      <span className="flex-[3]" style={{ background: p.brand }} />
                      <span className="flex-[2]" style={{ background: p.accent }} />
                    </div>
                    <div className="mt-2.5 flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-ink">{p.name}</span>
                      {active && <Icon name="check" size={15} className="text-ink" />}
                    </div>
                    {p.id === 'voxready' && <span className="text-[11px] text-faint">Predeterminada</span>}
                  </button>
                );
              })}
            </div>
          </Card>

          {/* Colores personalizados */}
          <Card>
            <CardHeader title="Colores personalizados" description="Usa los colores de tu marca. Los tonos para el modo oscuro se calculan automáticamente." />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {[
                { key: 'brand', label: 'Color principal', hint: 'Logo, avatares, gráficos y elementos de marca.' },
                { key: 'accent', label: 'Color de acento', hint: 'Botones de acción, destacados y progreso.' },
              ].map(({ key, label, hint }) => (
                <Field key={key} label={label} hint={hint}>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={isHex(form[key]) ? form[key] : '#000000'}
                      onChange={(e) => setColor(key, e.target.value.toUpperCase())}
                      aria-label={`${label} (selector)`}
                      className="h-10 w-12 shrink-0 cursor-pointer rounded-lg border border-line bg-surface p-1"
                    />
                    <input
                      className={cx('input font-mono uppercase', !isHex(form[key]) && 'border-danger')}
                      value={form[key]}
                      maxLength={7}
                      onChange={(e) => setColor(key, e.target.value.trim())}
                      aria-label={`${label} (código hexadecimal)`}
                    />
                  </div>
                </Field>
              ))}
            </div>
            {!valid && <p className="mt-3 text-[13px] text-danger">Usa un código de color con formato #RRGGBB.</p>}
            {warnings.map((w) => (
              <p key={w} className="mt-3 flex items-start gap-2 text-[13px] text-warning">
                <Icon name="alert" size={15} className="mt-0.5" />
                {w}
              </p>
            ))}
            {!samePalette(saved, DEFAULT_PALETTE) && (
              <div className="mt-5 pt-4 border-t border-line">
                <button type="button" onClick={() => save(DEFAULT_PALETTE)} disabled={saving} className="text-[13px] font-medium text-muted hover:text-ink">
                  Volver a los colores de VoxReady
                </button>
              </div>
            )}
          </Card>
        </div>

        {/* Vista previa */}
        <div>
          <Card className="lg:sticky lg:top-24">
            <CardHeader title="Vista previa" description="Así verán la plataforma tus voceros. Los cambios se ven en vivo hasta que los guardes." />
            <div className="rounded-xl border border-line bg-canvas overflow-hidden">
              <div className="flex items-center justify-between px-4 h-12 border-b border-line bg-surface">
                <Logo />
                <Avatar initials="AT" size="sm" />
              </div>
              <div className="p-4 space-y-4">
                <div className="flex items-center gap-4">
                  <ScoreRing value={82} size={84} stroke={8} />
                  <div className="min-w-0 space-y-2">
                    <div className="text-sm font-semibold text-ink">Prueba integral</div>
                    <div className="flex flex-wrap gap-1.5">
                      <Badge tone="accent">Crisis</Badge>
                      <Badge tone="brand">Dirección</Badge>
                    </div>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs text-muted">
                    <span>Empatía</span>
                    <span>74</span>
                  </div>
                  <Progress value={74} />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="accent" size="sm" icon="mic">
                    Practicar
                  </Button>
                  <Button variant="secondary" size="sm">
                    Ver progreso
                  </Button>
                </div>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
