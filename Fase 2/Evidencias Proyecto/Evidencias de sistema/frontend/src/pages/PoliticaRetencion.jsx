import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import I from '../data/dictionary';
import Icon from '../components/Icon';
import { Button, Badge, Card, CardHeader, EmptyState, Field, Modal, PageHeader, Radio, Segmented } from '../components/ui';
import { apiFetch, getCurrentUser } from '../lib/api';
import useApiData from '../hooks/useApiData';
import { formatDate } from '../data/directory';

const PRESETS = [
  { value: '30', label: '30 días' },
  { value: '90', label: '90 días' },
  { value: '180', label: '180 días' },
  { value: 'custom', label: 'Personalizado' },
];

// Estados de una solicitud de borrado
const REQ_STATUS = {
  PENDING: { label: 'Pendiente', tone: 'warning' },
  APPROVED: { label: 'Aprobada', tone: 'accent' },
  REJECTED: { label: 'Rechazada', tone: 'danger' },
  COMPLETED: { label: 'Completada', tone: 'success' },
};

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

  // Solicitudes de borrado
  const requests = useApiData('/api/deletion-requests');
  const usersData = useApiData('/api/users');
  const voceros = (usersData.data?.users || []).filter((u) => u.status === 'ACTIVE');
  const [creatingReq, setCreatingReq] = useState(false);
  const [target, setTarget] = useState('');
  const [reason, setReason] = useState('');
  const [scope, setScope] = useState('RECORDINGS');
  const [savingReq, setSavingReq] = useState(false);
  const me = getCurrentUser() || {};

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

  const submitRequest = async () => {
    if (!target) return toast.error('Selecciona un vocero.');
    try {
      setSavingReq(true);
      await apiFetch('/api/deletion-requests', { method: 'POST', body: { targetUserId: target, scope, reason } });
      toast.success('Solicitud creada');
      setCreatingReq(false);
      setTarget('');
      setReason('');
      setScope('RECORDINGS');
      requests.reload();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSavingReq(false);
    }
  };

  const processRequest = async (r, status) => {
    try {
      await apiFetch(`/api/deletion-requests/${r.id}`, { method: 'PATCH', body: { status } });
      toast.success('Solicitud actualizada');
      requests.reload();
    } catch (err) {
      toast.error(err.message);
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

      {/* Solicitudes de borrado */}
      <Card className="mt-6" padded={false}>
        <div className="p-6 pb-0">
          <CardHeader
            title={t.delL}
            description="Pide eliminar las grabaciones de un vocero. Los informes y métricas se conservan."
            action={
              <Button icon="plus" onClick={() => setCreatingReq(true)}>
                Nueva solicitud
              </Button>
            }
          />
        </div>
        {requests.data?.requests?.length ? (
          <ul className="divide-y divide-line border-t border-line">
            {requests.data.requests.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-4 px-6 py-4">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-ink truncate">{r.targetUser?.name || 'Organización completa'}</div>
                  <div className="text-xs text-muted truncate">
                    {r.reason || 'Sin motivo indicado'} · {formatDate(r.createdAt)}
                  </div>
                </div>
                <Badge tone={REQ_STATUS[r.status]?.tone || 'neutral'}>{REQ_STATUS[r.status]?.label || r.status}</Badge>
                <div className="flex gap-1 items-center">
                  {me.role === 'admin' && r.requestedBy?.id === me.id && ['PENDING', 'APPROVED'].includes(r.status) ? (
                    <span className="text-xs text-faint max-w-[200px] text-right">La resolución la realiza el equipo VoxReady.</span>
                  ) : (
                    <>
                      {r.status === 'PENDING' && (
                        <>
                          <Button variant="ghost" size="sm" icon="check" onClick={() => processRequest(r, 'APPROVED')}>
                            Aprobar
                          </Button>
                          <Button variant="ghost" size="sm" icon="x" className="text-danger hover:bg-danger/10" onClick={() => processRequest(r, 'REJECTED')}>
                            Rechazar
                          </Button>
                        </>
                      )}
                      {r.status === 'APPROVED' && (
                        <Button variant="ghost" size="sm" icon="trash" onClick={() => processRequest(r, 'COMPLETED')}>
                          Completar
                        </Button>
                      )}
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="px-6 pb-6">
            <EmptyState icon="shield" title="Sin solicitudes de borrado" description="No hay solicitudes registradas para tu organización." />
          </div>
        )}
      </Card>

      {creatingReq && (
        <Modal
          open
          onClose={() => setCreatingReq(false)}
          title="Nueva solicitud de borrado"
          description={
            scope === 'ANONYMIZE'
              ? 'Se anonimizará al vocero: se eliminan sus datos personales, el contenido de sus sesiones y sus grabaciones.'
              : 'Se eliminarán las grabaciones del vocero seleccionado.'
          }
          footer={
            <>
              <Button variant="ghost" onClick={() => setCreatingReq(false)}>
                Cancelar
              </Button>
              <Button icon="check" onClick={submitRequest} disabled={savingReq}>
                {savingReq ? 'Creando…' : 'Crear solicitud'}
              </Button>
            </>
          }
        >
          <div className="space-y-5">
            <Field label="Tipo de solicitud">
              <div className="space-y-2">
                <Radio
                  checked={scope === 'RECORDINGS'}
                  onChange={() => setScope('RECORDINGS')}
                  title="Eliminar grabaciones"
                  description="Borra los videos del vocero; conserva informes y métricas."
                />
                <Radio
                  checked={scope === 'ANONYMIZE'}
                  onChange={() => setScope('ANONYMIZE')}
                  title="Anonimizar vocero"
                  description="Elimina los datos personales y el contenido de sus sesiones; conserva el histórico estadístico."
                />
              </div>
            </Field>
            <Field label="Vocero">
              <select className="input" value={target} onChange={(e) => setTarget(e.target.value)}>
                <option value="">Selecciona un vocero…</option>
                {voceros.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name} · {v.email}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Motivo" hint="Opcional. Queda registrado en la solicitud.">
              <textarea
                className="textarea min-h-[80px]"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Ej. Solicitud del titular por derecho al olvido."
              />
            </Field>
          </div>
        </Modal>
      )}
    </>
  );
}
