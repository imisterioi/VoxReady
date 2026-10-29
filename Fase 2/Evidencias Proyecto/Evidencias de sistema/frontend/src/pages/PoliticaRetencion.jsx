import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import I from '../data/dictionary';
import Icon from '../components/Icon';
import { Button, Card, CardHeader, EmptyState, Modal, PageHeader, Radio, Segmented } from '../components/ui';
import RequestsPanel from '../components/RequestsPanel';
import RequestFormModal from '../components/RequestFormModal';
import { apiFetch } from '../lib/api';
import { displayEmail } from '../lib/displayEmail';
import { buildRequestsFeed } from '../lib/requestsFeed';
import { MAX_DAYS } from '../lib/requestForm';
import useApiData from '../hooks/useApiData';
import { formatDate } from '../data/directory';

const PRESETS = [
  { value: '30', label: '30 días' },
  { value: '90', label: '90 días' },
  { value: '180', label: '180 días' },
  { value: 'custom', label: 'Personalizado' },
];

// Cómo se lee cada modo de conservación para el administrador del cliente.
const MODE_LABELS = {
  FULL: 'Video, audio y métricas',
  METRICS: 'Solo métricas derivadas',
};

// Estados de una solicitud de privacidad
const REQ_STATUS = {
  PENDING: { label: 'Pendiente', tone: 'warning' },
  APPROVED: { label: 'Aprobada', tone: 'accent' },
  REJECTED: { label: 'Rechazada', tone: 'danger' },
  COMPLETED: { label: 'Completada', tone: 'success' },
};

// Estados de una solicitud de extensión del plazo
const EXT_STATUS = {
  PENDING: { label: 'Pendiente de revisión', tone: 'warning' },
  APPROVED: { label: 'Aprobada y aplicada', tone: 'success' },
  REJECTED: { label: 'Rechazada', tone: 'danger' },
};

// Política de retención de la organización (GET/PUT /api/tenant/settings).
//
// - El plan vigente y las fechas salen del backend, calculadas con la MISMA lógica que aplica la
//   retención (no se estiman fechas).
// - Un cambio de plan se PROGRAMA: no altera retroactivamente las sesiones que ya están bajo el
//   plan vigente; se aplica al terminar el periodo actual (fecha efectiva que muestra la ventana).
// - Para conservar más tiempo los datos que ya existen se crea una SOLICITUD DE EXTENSIÓN, que
//   resuelve únicamente el equipo VoxReady (administrador del sistema).
export default function PoliticaRetencion() {
  const t = I.es.L.a3;
  const settings = useApiData('/api/tenant/settings');
  const practices = useApiData('/api/practices');

  const [mode, setMode] = useState('FULL');
  const [preset, setPreset] = useState('90');
  const [customDays, setCustomDays] = useState(365);
  const [saving, setSaving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Solicitudes (el administrador de la organización solo crea y consulta: no resuelve)
  const requests = useApiData('/api/deletion-requests');
  const extensions = useApiData('/api/retention-requests');
  const usersData = useApiData('/api/users');
  const voceros = (usersData.data?.users || []).filter((u) => u.status === 'ACTIVE');
  // Un ÚNICO formulario para crear cualquier tipo de solicitud: el tipo se elige dentro de la
  // ventana y los campos se adaptan a él (ver components/RequestFormModal.jsx).
  const [creating, setCreating] = useState(false);
  const [savingRequest, setSavingRequest] = useState(false);
  const [openRequest, setOpenRequest] = useState(null);
  const [openExtension, setOpenExtension] = useState(null);
  // Filtro interno del panel único de solicitudes (Todas / Privacidad / Retención).
  const [requestFilter, setRequestFilter] = useState('all');

  const plan = settings.data?.plan || null;
  const currentMode = settings.data?.settings?.retentionMode || 'FULL';
  const currentDays = settings.data?.settings?.retentionDays || 90;
  const pendingChange = plan?.pending || null;

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
  const extensionRequests = extensions.data?.requests || [];
  const pendingExtension = extensionRequests.find((r) => r.status === 'PENDING') || null;
  const dirty = mode !== currentMode || days !== currentDays;

  // Fecha efectiva del cambio: fin del periodo actual (la calcula el backend con los datos reales).
  const effectiveAt = plan?.periodEndsAt ? new Date(plan.periodEndsAt) : new Date();

  const openConfirm = () => {
    if (!dirty) return toast('El plan seleccionado ya es el vigente.');
    if (!Number.isFinite(days) || days < 1 || days > MAX_DAYS) return toast.error(`El plazo debe estar entre 1 y ${MAX_DAYS} días.`);
    setConfirmOpen(true);
  };

  const applyPlan = async () => {
    try {
      setSaving(true);
      const result = await apiFetch('/api/tenant/settings', { method: 'PUT', body: { retentionMode: mode, retentionDays: days } });
      if (result?.applied === 'now') toast.success('Plan actualizado');
      else if (result?.applied === 'none') toast.success('El plan vigente ya era ese: se canceló el cambio programado');
      else toast.success(`Cambio programado para el ${formatDate(result?.effectiveAt)}`);
      setConfirmOpen(false);
      settings.reload();
      practices.reload();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  // Crea la solicitud en el endpoint que corresponde al tipo elegido (lo decide lib/requestForm).
  // El cuerpo solo lleva los campos de ese tipo: nunca los del tipo anterior.
  const createRequest = async (payload) => {
    try {
      setSavingRequest(true);
      await apiFetch(payload.endpoint, { method: 'POST', body: payload.body });
      toast.success('Solicitud creada');
      setCreating(false);
      // Se refrescan las dos listas: la solicitud nueva puede ser de cualquiera de los dos tipos.
      requests.reload();
      extensions.reload();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSavingRequest(false);
    }
  };

  // Panel ÚNICO de solicitudes: los dos tipos en una sola lista ordenada por fecha. Cada elemento
  // conserva la solicitud original (`raw`) para abrir su ventana de detalle (solo lectura aquí).
  const requestItems = useMemo(
    () =>
      buildRequestsFeed({
        privacy: requests.data?.requests || [],
        extensions: extensions.data?.requests || [],
      }).map((entry) => {
        const r = entry.request;
        if (entry.kind === 'privacy') {
          const status = REQ_STATUS[r.status] || { label: r.status, tone: 'neutral' };
          return {
            key: `privacy-${r.id}`,
            kind: 'privacy',
            raw: r,
            title: r.scope === 'ANONYMIZE' ? 'Anonimización completa' : 'Borrado de grabaciones',
            subtitle: [
              r.targetUser ? `${r.targetUser.name} · ${displayEmail(r.targetUser)}` : 'Organización completa',
              r.reason || 'Sin motivo indicado',
              formatDate(r.createdAt),
            ].join(' · '),
            meta: r.resolvedAt
              ? `Resuelta el ${formatDate(r.resolvedAt)}${r.resolvedBy?.name ? ` por ${r.resolvedBy.name}` : ''}`
              : 'Pendiente: la revisa el equipo VoxReady',
            status,
            actionLabel: 'Ver',
          };
        }
        const status = EXT_STATUS[r.status] || { label: r.status, tone: 'neutral' };
        return {
          key: `retention-${r.id}`,
          kind: 'retention',
          raw: r,
          title: `Extensión a ${r.requestedDays} días (vigente: ${r.currentDays})`,
          subtitle: [r.reason || 'Sin motivo indicado', formatDate(r.createdAt)].join(' · '),
          meta: r.resolvedAt
            ? `Resuelta el ${formatDate(r.resolvedAt)}${r.resolvedBy?.name ? ` por ${r.resolvedBy.name}` : ''}`
            : 'Pendiente: la revisa el equipo VoxReady',
          status,
          actionLabel: 'Ver',
        };
      }),
    [requests.data, extensions.data],
  );

  // Abrir la ventana de detalle de la solicitud seleccionada (privacidad o extensión).
  const openRequestDetail = (item) => {
    if (item.kind === 'privacy') setOpenRequest(item.raw);
    else setOpenExtension(item.raw);
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
          <Button icon="check" onClick={openConfirm} disabled={saving || !dirty}>
            {saving ? 'Guardando…' : 'Solicitar cambio'}
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
                  max={MAX_DAYS}
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
            <p className="flex items-start gap-2 text-[13px] text-muted mt-2 leading-relaxed">
              <Icon name="clock" size={15} className="mt-0.5 text-faint" />
              Los cambios de plan no afectan a las sesiones que ya están bajo el plan vigente: se aplican al
              terminar el periodo actual.
            </p>
          </Card>
        </div>

        <div className="space-y-6 h-fit">
          <Card>
            <CardHeader title="Política actual" description="Se aplica a las sesiones que se realizan hoy." />
            <div className="space-y-3">
              <PlanRow label="Qué se conserva" value={MODE_LABELS[currentMode] || currentMode} />
              <PlanRow label="Plazo de conservación" value={`${currentDays} días`} />
              <PlanRow
                label="Próxima eliminación automática"
                value={plan?.nextPurgeAt ? formatDate(plan.nextPurgeAt) : 'No hay datos dentro del plazo'}
              />
              <PlanRow
                label="Fin del periodo actual"
                value={plan?.periodEndsAt ? formatDate(plan.periodEndsAt) : 'Sin datos bajo el plan vigente'}
                hint="Cuando termine este periodo se aplicará el cambio de plan solicitado."
              />
              <PlanRow
                label="Sesiones registradas"
                value={`${plan?.sessions ?? 0}${plan?.expiredSessions ? ` · ${plan.expiredSessions} ya vencidas` : ''}`}
              />
            </div>

            {pendingChange && (
              <div className="mt-5 rounded-xl bg-accent-soft px-4 py-3">
                <div className="text-xs font-medium text-accent-fg">Cambio de plan programado</div>
                <div className="text-sm text-ink mt-1">
                  {MODE_LABELS[pendingChange.mode] || pendingChange.mode} · {pendingChange.days} días
                </div>
                <div className="text-xs text-muted mt-1">
                  Se aplicará el {pendingChange.effectiveAt ? formatDate(pendingChange.effectiveAt) : '—'}. Hasta
                  entonces continúa vigente el plan actual.
                </div>
              </div>
            )}
          </Card>

          <Card>
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
                Se conserva <b className="text-ink font-medium">{MODE_LABELS[currentMode]?.toLowerCase()}</b> durante{' '}
                <b className="text-ink font-medium">{currentDays} días</b>. El sistema revisa y aplica esta política
                automáticamente.
              </p>
            </div>
          </Card>
        </div>
      </div>


      {/* Panel ÚNICO de solicitudes: privacidad y extensión del plazo en una sola sección. El
          administrador de la organización las crea y sigue su estado; resolverlas corresponde
          únicamente al administrador del sistema. */}
      <RequestsPanel
        title="Solicitudes"
        description="Solicitudes de privacidad (borrado o anonimización de un vocero) y de extensión del plazo de conservación, en una sola lista. Puedes crearlas y seguir su estado; la resolución la realiza el equipo VoxReady."
        actions={
          <Button icon="plus" onClick={() => setCreating(true)}>
            Nueva solicitud
          </Button>
        }
        items={requestItems}
        filter={requestFilter}
        onFilterChange={setRequestFilter}
        onOpen={openRequestDetail}
        loading={requests.loading || extensions.loading}
        error={requests.error || extensions.error}
        emptyTitle="Sin solicitudes"
        emptyDescription="Puedes pedir el borrado o la anonimización de un vocero, o una extensión del plazo de conservación."
        note="Solo el administrador del sistema (equipo VoxReady) puede aprobar, rechazar o completar estas solicitudes; tú puedes crearlas y consultar su estado."
      />


      {/* Confirmación del cambio de plan: plan actual, plan nuevo, plazos, fecha efectiva y aviso */}
      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Confirmar cambio de plan de retención"
        description="Revisa el cambio antes de solicitarlo."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)} disabled={saving}>
              Cancelar
            </Button>
            <Button icon="check" onClick={applyPlan} disabled={saving}>
              {saving ? 'Aplicando…' : 'Aplicar'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="rounded-xl border border-line p-4">
              <div className="text-xs text-muted">Plan actual</div>
              <div className="text-sm font-medium text-ink mt-1">{MODE_LABELS[currentMode] || currentMode}</div>
              <div className="text-xs text-muted mt-1">{currentDays} días</div>
            </div>
            <div className="rounded-xl border border-accent/40 bg-accent-soft p-4">
              <div className="text-xs text-muted">Plan nuevo</div>
              <div className="text-sm font-medium text-ink mt-1">{MODE_LABELS[mode] || mode}</div>
              <div className="text-xs text-muted mt-1">{days} días</div>
            </div>
          </div>

          <DetailRow label="Plazo de conservación" value={`${currentDays} días → ${days} días`} />
          <DetailRow label="Fecha efectiva del cambio" value={formatDate(effectiveAt)} />

          <p className="text-[13px] text-muted leading-relaxed">
            Los cambios se aplicarán a partir del <b className="text-ink">{formatDate(effectiveAt)}</b>. Hasta
            entonces, continuará vigente el plan actual ({MODE_LABELS[currentMode]?.toLowerCase()} · {currentDays}{' '}
            días).
          </p>
          <p className="text-xs text-faint leading-relaxed">
            Las sesiones que ya están dentro del plazo actual no se modifican: sus vencimientos siguen calculándose
            con el plan vigente. Si necesitas conservar los datos que ya existen durante más tiempo, usa una
            solicitud de extensión.
          </p>
        </div>
      </Modal>

      {/* ÚNICO formulario de creación: se elige el tipo de solicitud y los campos se adaptan a él */}
      {creating && (
        <RequestFormModal
          onClose={() => setCreating(false)}
          onSubmit={createRequest}
          voceros={voceros}
          currentDays={currentDays}
          pendingExtension={pendingExtension}
          saving={savingRequest}
        />
      )}


      {/* Detalle (solo lectura) de una solicitud de privacidad: la resuelve el administrador del sistema */}
      <Modal
        open={Boolean(openRequest)}
        onClose={() => setOpenRequest(null)}
        title={
          openRequest
            ? openRequest.scope === 'ANONYMIZE'
              ? 'Anonimización completa'
              : 'Borrado de grabaciones'
            : 'Solicitud'
        }
        description={openRequest ? `Estado: ${REQ_STATUS[openRequest.status]?.label || openRequest.status}` : ''}
        footer={
          <Button variant="ghost" onClick={() => setOpenRequest(null)}>
            Cerrar
          </Button>
        }
      >
        {openRequest && (
          <div className="space-y-4">
            <DetailRow
              label="Vocero"
              value={
                openRequest.targetUser
                  ? `${openRequest.targetUser.name} · ${displayEmail(openRequest.targetUser)}`
                  : 'Organización completa'
              }
            />
            <DetailRow label="Solicitada" value={formatDate(openRequest.createdAt)} />
            <DetailRow label="Motivo" value={openRequest.reason || 'Sin motivo indicado'} />
            <DetailRow
              label="Resolución"
              value={
                openRequest.resolvedAt
                  ? `${formatDate(openRequest.resolvedAt)}${openRequest.resolvedBy?.name ? ` · ${openRequest.resolvedBy.name}` : ''}`
                  : 'Pendiente (la realiza el equipo VoxReady)'
              }
            />
            {openRequest.resolutionNote && <DetailRow label="Nota de resolución" value={openRequest.resolutionNote} />}
            <p className="text-xs text-faint leading-relaxed">
              Consultar una solicitud no la modifica. Solo el administrador del sistema puede aprobarla, rechazarla o
              completarla.
            </p>
          </div>
        )}
      </Modal>

      {/* Detalle (solo lectura) de una solicitud de extensión */}
      <Modal
        open={Boolean(openExtension)}
        onClose={() => setOpenExtension(null)}
        title="Solicitud de extensión del plazo"
        description={openExtension ? `Estado: ${EXT_STATUS[openExtension.status]?.label || openExtension.status}` : ''}
        footer={
          <Button variant="ghost" onClick={() => setOpenExtension(null)}>
            Cerrar
          </Button>
        }
      >
        {openExtension && (
          <div className="space-y-4">
            <DetailRow label="Plazo vigente al solicitarla" value={`${openExtension.currentDays} días`} />
            <DetailRow label="Plazo solicitado" value={`${openExtension.requestedDays} días`} />
            {openExtension.appliedDays ? (
              <DetailRow label="Plazo aplicado" value={`${openExtension.appliedDays} días`} />
            ) : null}
            <DetailRow label="Solicitada" value={formatDate(openExtension.createdAt)} />
            <DetailRow label="Motivo" value={openExtension.reason || 'Sin motivo indicado'} />
            <DetailRow
              label="Resolución"
              value={
                openExtension.resolvedAt
                  ? `${formatDate(openExtension.resolvedAt)}${openExtension.resolvedBy?.name ? ` · ${openExtension.resolvedBy.name}` : ''}`
                  : 'Pendiente (la realiza el equipo VoxReady)'
              }
            />
            {openExtension.resolutionNote && <DetailRow label="Nota de resolución" value={openExtension.resolutionNote} />}
            <p className="text-xs text-faint leading-relaxed">
              Solo el administrador del sistema puede aprobar o rechazar esta solicitud. Mientras esté pendiente, el
              plan vigente no cambia.
            </p>
          </div>
        )}
      </Modal>
    </>
  );
}

// Fila de dato simple dentro de las tarjetas del plan vigente.
function PlanRow({ label, value, hint }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-[13px] text-muted">{label}</span>
        <span className="text-sm text-ink font-medium text-right break-words min-w-0">{value}</span>
      </div>
      {hint && <div className="text-[11px] text-faint mt-1">{hint}</div>}
    </div>
  );
}

// Fila de dato simple dentro de una ventana de detalle.
function DetailRow({ label, value }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-4">
      <span className="text-xs text-muted sm:w-48 shrink-0">{label}</span>
      <span className="text-sm text-ink break-words min-w-0">{value}</span>
    </div>
  );
}