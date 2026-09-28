import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import I from '../data/dictionary';
import Icon from '../components/Icon';
import { Button, Card, CardHeader, EmptyState, PageHeader, Radio, Segmented } from '../components/ui';
import { apiFetch } from '../lib/api';
import useApiData from '../hooks/useApiData';

const PRESETS = [
  { value: '30', label: '30 días' },
  { value: '90', label: '90 días' },
  { value: '180', label: '180 días' },
  { value: 'custom', label: 'Personalizado' },
];

// Política de retención de la organización (GET/PUT /api/tenant/settings).
// El backend la aplica: borra los videos vencidos cada 6 horas y, en modo
// "solo métricas", elimina la grabación apenas se genera el informe.
export default function PoliticaRetencion() {
  const t = I.es.L.a3;
  const settings = useApiData('/api/tenant/settings');
  const practices = useApiData('/api/practices');

  const [mode, setMode] = useState('FULL');
  const [preset, setPreset] = useState('90');
  const [customDays, setCustomDays] = useState(365);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const s = settings.data?.settings;
    if (!s) return;
    setMode(s.retentionMode);
    const known = ['30', '90', '180'].includes(String(s.retentionDays));
    setPreset(known ? String(s.retentionDays) : 'custom');
    if (!known) setCustomDays(s.retentionDays);
  }, [settings.data]);

  const days = preset === 'custom' ? Number(customDays) : Number(preset);
  const list = practices.data?.practices || [];
  const withVideo = list.filter((p) => p.hasVideo).length;

  const save = async () => {
    try {
      setSaving(true);
      await apiFetch('/api/tenant/settings', { method: 'PUT', body: { retentionMode: mode, retentionDays: days } });
      toast.success('Política de retención guardada');
      settings.reload();
      practices.reload();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (settings.loading && !settings.data) {
    return (
      <Card>
        <EmptyState icon="refresh" title="Cargando política…" />
      </Card>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow={t.eyebrow}
        title={t.title}
        description={t.sub}
        actions={
          <Button icon="check" onClick={save} disabled={saving}>
            {saving ? 'Guardando…' : 'Guardar política'}
          </Button>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-[1.3fr_1fr] gap-6">
        <div className="space-y-6">
          <Card>
            <CardHeader title={t.q1} />
            <div className="space-y-3">
              <Radio checked={mode === 'FULL'} onChange={() => setMode('FULL')} title={t.opt1} description={t.opt1d} />
              <Radio checked={mode === 'METRICS'} onChange={() => setMode('METRICS')} title={t.opt2} description={t.opt2d} />
            </div>
          </Card>

          <Card>
            <CardHeader title={t.termL} />
            <Segmented options={PRESETS} value={preset} onChange={setPreset} />
            {preset === 'custom' && (
              <div className="mt-4 flex items-center gap-3">
                <input
                  type="number"
                  min="1"
                  max="3650"
                  className="input w-32"
                  value={customDays}
                  onChange={(e) => setCustomDays(e.target.value)}
                />
                <span className="text-sm text-muted">días</span>
              </div>
            )}
            <p className="flex items-start gap-2 text-[13px] text-muted mt-4 leading-relaxed">
              <Icon name="info" size={15} className="mt-0.5 text-faint" />
              {t.termLeg} Los informes y métricas se conservan; solo se borran los videos.
            </p>
          </Card>
        </div>

        <Card className="h-fit">
          <CardHeader title="Grabaciones de tu organización" />
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-subtle/60 px-4 py-3">
              <div className="text-xs text-muted">Prácticas evaluadas</div>
              <div className="text-2xl font-semibold tabular-nums text-ink mt-1">{list.length}</div>
            </div>
            <div className="rounded-xl bg-subtle/60 px-4 py-3">
              <div className="text-xs text-muted">Con video guardado</div>
              <div className="text-2xl font-semibold tabular-nums text-ink mt-1">{withVideo}</div>
            </div>
          </div>
          <div className="mt-6 rounded-xl bg-subtle/60 p-4 flex gap-3">
            <Icon name="shield" size={18} className="text-muted mt-0.5" />
            <p className="text-xs text-muted leading-relaxed">
              Resumen: se conserva <b className="text-ink font-medium">{mode === 'FULL' ? 'video, audio y métricas' : 'solo métricas'}</b>
              {mode === 'FULL' && (
                <>
                  {' '}
                  y los videos se eliminan a los <b className="text-ink font-medium">{days || '—'} días</b>
                </>
              )}
              . El sistema revisa y aplica esta política automáticamente.
            </p>
          </div>
        </Card>
      </div>
    </>
  );
}
