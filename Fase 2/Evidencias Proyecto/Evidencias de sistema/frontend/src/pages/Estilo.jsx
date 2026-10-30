import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import Icon from '../components/Icon';
import Logo from '../components/Logo';
import { Avatar, Badge, Button, Card, CardHeader, EmptyState, Field, PageHeader, Progress, ScoreRing, cx } from '../components/ui';
import useApiData from '../hooks/useApiData';
import { apiFetch } from '../lib/api';
import { LANGUAGES, LANGUAGE_LABELS, useI18n } from '../lib/i18n';
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
  const tenantLanguage = useApiData('/api/tenant/language');
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [langForm, setLangForm] = useState(null);
  const [savingLang, setSavingLang] = useState(false);
  const { d } = useI18n();
  const t = d.L.a7;

  useEffect(() => {
    if (tenantLanguage.data?.language) setLangForm(tenantLanguage.data.language);
  }, [tenantLanguage.data]);

  const saveLanguage = async () => {
    setSavingLang(true);
    try {
      const { language } = await apiFetch('/api/tenant/language', { method: 'PUT', body: { language: langForm } });
      setLangForm(language);
      toast.success(t.langSaved);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSavingLang(false);
    }
  };

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
        <EmptyState tone="danger" icon="server" title={t.loadFailed} description={branding.error} />
      </Card>
    );
  }
  if (!form) {
    return (
      <Card>
        <EmptyState icon="refresh" title={t.loading} />
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
      toast.success(isDefault ? t.restoredDefault : t.savedOrg);
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
        eyebrow={t.eyebrow}
        title={t.title}
        description={t.desc(branding.data?.branding?.name || t.title)}
        actions={
          <>
            <Button variant="secondary" icon="refresh" onClick={() => setForm(saved)} disabled={!changed || saving}>
              {t.discard}
            </Button>
            <Button icon="check" onClick={() => save(form)} disabled={!changed || saving}>
              {saving ? t.saving : t.save}
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-[1.3fr_1fr] gap-6">
        <div className="space-y-6">
          {/* Paletas sugeridas */}
          <Card>
            <CardHeader title={t.presetsTitle} description={t.presetsDesc} />
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
                    {p.id === 'voxready' && <span className="text-[11px] text-faint">{t.presetDefault}</span>}
                  </button>
                );
              })}
            </div>
          </Card>

          {/* Colores personalizados */}
          <Card>
            <CardHeader title={t.customTitle} description={t.customDesc} />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {[
                { key: 'brand', label: t.colorBrand, hint: t.colorBrandHint },
                { key: 'accent', label: t.colorAccent, hint: t.colorAccentHint },
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
                      aria-label={t.hexLabel(label)}
                    />
                  </div>
                </Field>
              ))}
            </div>
            {!valid && <p className="mt-3 text-[13px] text-danger">{t.hexError}</p>}
            {warnings.map((w) => (
              <p key={w} className="mt-3 flex items-start gap-2 text-[13px] text-warning">
                <Icon name="alert" size={15} className="mt-0.5" />
                {w}
              </p>
            ))}
            {!samePalette(saved, DEFAULT_PALETTE) && (
              <div className="mt-5 pt-4 border-t border-line">
                <button type="button" onClick={() => save(DEFAULT_PALETTE)} disabled={saving} className="text-[13px] font-medium text-muted hover:text-ink">
                  {t.restore}
                </button>
              </div>
            )}
          </Card>

          {/* Idioma por defecto de la organización */}
          <Card>
            <CardHeader title={t.langTitle} description={t.langDesc} />
            <Field label={t.langLabel}>
              <select
                className="input"
                value={langForm ?? ''}
                onChange={(e) => setLangForm(e.target.value)}
                aria-label={t.langLabel}
              >
                {LANGUAGES.map((code) => (
                  <option key={code} value={code}>
                    {LANGUAGE_LABELS[code]}
                  </option>
                ))}
              </select>
            </Field>
            <div className="mt-5 pt-4 border-t border-line">
              <Button variant="accent" size="sm" onClick={saveLanguage} disabled={savingLang || !langForm}>
                {t.langSave}
              </Button>
            </div>
          </Card>
        </div>

        {/* Vista previa */}
        <div>
          <Card className="lg:sticky lg:top-24">
            <CardHeader title={t.previewTitle} description={t.previewDesc} />
            <div className="rounded-xl border border-line bg-canvas overflow-hidden">
              <div className="flex items-center justify-between px-4 h-12 border-b border-line bg-surface">
                <Logo />
                <Avatar initials="AT" size="sm" />
              </div>
              <div className="p-4 space-y-4">
                <div className="flex items-center gap-4">
                  <ScoreRing value={82} size={84} stroke={8} />
                  <div className="min-w-0 space-y-2">
                    <div className="text-sm font-semibold text-ink">{t.previewName}</div>
                    <div className="flex flex-wrap gap-1.5">
                      <Badge tone="accent">{t.previewCrisis}</Badge>
                      <Badge tone="brand">{t.previewDirection}</Badge>
                    </div>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs text-muted">
                    <span>{t.previewEmpathy}</span>
                    <span>74</span>
                  </div>
                  <Progress value={74} />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="accent" size="sm" icon="mic">
                    {t.practice}
                  </Button>
                  <Button variant="secondary" size="sm">
                    {t.progress}
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
