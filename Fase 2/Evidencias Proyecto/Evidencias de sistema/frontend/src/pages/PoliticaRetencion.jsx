import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { useI18n } from '../lib/i18n';
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
  { value: '30', labelKey: 'preset30' },
  { value: '90', labelKey: 'preset90' },
  { value: '180', labelKey: 'preset180' },
  { value: 'custom', labelKey: 'presetCustom' },
];

// Cómo se lee cada modo de conservación para el administrador del cliente (el valor no se traduce).
const MODE_LABEL_KEYS = { FULL: 'modeFull', METRICS: 'modeMetrics' };

// Estados de una solicitud de privacidad (el código interno no se traduce).
const REQ_STATUS = {
  PENDING: 'warning',
  APPROVED: 'accent',
  REJECTED: 'danger',
  COMPLETED: 'success',
};

// Estados de una solicitud de extensión del plazo
const EXT_STATUS = {
  PENDING: 'warning',
  APPROVED: 'success',
  REJECTED: 'danger',
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
  const { d, lang } = useI18n();
  const t = d.L.a3;
  const p = d.L.privacy;
  // Etiqueta visible de un modo de conservación y de un estado (los códigos no se traducen).
  const modeLabel = (value) => (value ? t[MODE_LABEL_KEYS[value]] || value : value);
  const reqStatus = (status) => ({ tone: REQ_STATUS[status] || 'neutral', label: p.privacyStatus[status] || status });
  const extStatus = (status) => ({ tone: EXT_STATUS[status] || 'neutral', label: p.extensionStatus[status] || status });
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
    if (!dirty) return toast(t.planAlreadyCurrent);
    if (!Number.isFinite(days) || days < 1 || days > MAX_DAYS) return toast.error(t.termRangeError(MAX_DAYS));
    setConfirmOpen(true);
  };

  const applyPlan = async () => {
    try {
      setSaving(true);
      const result = await apiFetch('/api/tenant/settings', { method: 'PUT', body: { retentionMode: mode, retentionDays: days } });
      if (result?.applied === 'now') toast.success(t.planUpdated);
      else if (result?.applied === 'none') toast.success(t.planCancelled);
      else toast.success(t.changeScheduledFor(formatDate(result?.effectiveAt, lang)));
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
      toast.success(t.requestCreated);
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
          const status = reqStatus(r.status);
          return {
            key: `privacy-${r.id}`,
            kind: 'privacy',
            raw: r,
            title: r.scope === 'ANONYMIZE' ? p.scopeAnonymize : p.scopeRecordings,
            subtitle: [
              r.targetUser ? `${r.targetUser.name} · ${displayEmail(r.targetUser)}` : p.wholeOrg,
              r.reason || p.noReason,
              formatDate(r.createdAt, lang),
            ].join(' · '),
            meta: r.resolvedAt
              ? p.resolvedOn(formatDate(r.resolvedAt, lang), r.resolvedBy?.name)
              : p.pendingReview,
            status,
            actionLabel: p.view,
          };
        }
        const status = extStatus(r.status);
        return {
          key: `retention-${r.id}`,
          kind: 'retention',
          raw: r,
          title: p.extensionRow(r.requestedDays, r.currentDays),
          subtitle: [r.reason || p.noReason, formatDate(r.createdAt, lang)].join(' · '),
          meta: r.resolvedAt
            ? p.resolvedOn(formatDate(r.resolvedAt, lang), r.resolvedBy?.name)
            : p.pendingReview,
          status,
          actionLabel: p.view,
        };
      }),
    [requests.data, extensions.data, lang],
  );

  // Abrir la ventana de detalle de la solicitud seleccionada (privacidad o extensión).
  const openRequestDetail = (item) => {
    if (item.kind === 'privacy') setOpenRequest(item.raw);
    else setOpenExtension(item.raw);
  };

  if (settings.loading && !settings.data) {
    return (
      <Card>
        <EmptyState icon="refresh" title={t.loadingL} />
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
            {saving ? t.savingL : t.requestChange}
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
            <Segmented
              options={PRESETS.map((pr) => ({ value: pr.value, label: t[pr.labelKey] }))}
              value={preset}
              onChange={setPreset}
            />
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
                <span className="text-sm text-muted">{t.daysL}</span>
              </div>
            )}
            <p className="flex items-start gap-2 text-[13px] text-muted mt-4 leading-relaxed">
              <Icon name="info" size={15} className="mt-0.5 text-faint" />
              {t.termLeg} {t.reportsKept}
            </p>
            <p className="flex items-start gap-2 text-[13px] text-muted mt-2 leading-relaxed">
              <Icon name="clock" size={15} className="mt-0.5 text-faint" />
              {t.planChangesNote}
            </p>
          </Card>
        </div>

        <div className="space-y-6 h-fit">
          <Card>
            <CardHeader title={t.currentPolicyTitle} description={t.currentPolicyDesc} />
            <div className="space-y-3">
              <PlanRow label={t.keepsL} value={modeLabel(currentMode)} />
              <PlanRow label={t.termChangeL} value={t.daysL(currentDays)} />
              <PlanRow
                label={t.nextPurgeL}
                value={plan?.nextPurgeAt ? formatDate(plan.nextPurgeAt, lang) : t.noDataInTerm}
              />
              <PlanRow
                label={t.periodEndL}
                value={plan?.periodEndsAt ? formatDate(plan.periodEndsAt, lang) : t.noDataUnderPlan}
                hint={t.periodEndHint}
              />
              <PlanRow
                label={t.sessionsL}
                value={`${plan?.sessions ?? 0}${plan?.expiredSessions ? ` · ${t.alreadyExpired(plan.expiredSessions)}` : ''}`}
              />
            </div>

            {pendingChange && (
              <div className="mt-5 rounded-xl bg-accent-soft px-4 py-3">
                <div className="text-xs font-medium text-accent-fg">{t.scheduledChange}</div>
                <div className="text-sm text-ink mt-1">
                  {modeLabel(pendingChange.mode)} · {t.daysL(pendingChange.days)}
                </div>
                <div className="text-xs text-muted mt-1">
                  {t.willApplyOn(pendingChange.effectiveAt ? formatDate(pendingChange.effectiveAt, lang) : '—')}
                </div>
              </div>
            )}
          </Card>

          <Card>
            <CardHeader title={t.recordingsTitle} />
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-subtle/60 px-4 py-3">
                <div className="text-xs text-muted">{t.evaluatedL}</div>
                <div className="text-2xl font-semibold tabular-nums text-ink mt-1">{list.length}</div>
              </div>
              <div className="rounded-xl bg-subtle/60 px-4 py-3">
                <div className="text-xs text-muted">{t.withVideoL}</div>
                <div className="text-2xl font-semibold tabular-nums text-ink mt-1">{withVideo}</div>
              </div>
            </div>
            <div className="mt-6 rounded-xl bg-subtle/60 p-4 flex gap-3">
              <Icon name="shield" size={18} className="text-muted mt-0.5" />
              <p className="text-xs text-muted leading-relaxed">
                {t.keepsL} <b className="text-ink font-medium">{modeLabel(currentMode).toLowerCase()}</b>{' '}
                <b className="text-ink font-medium">{t.daysL(currentDays)}</b>
                {t.keptSummaryTail}
              </p>
            </div>
          </Card>
        </div>
      </div>


      {/* Panel ÚNICO de solicitudes: privacidad y extensión del plazo en una sola sección. El
          administrador de la organización las crea y sigue su estado; resolverlas corresponde
          únicamente al administrador del sistema. */}
      <RequestsPanel
        title={t.requestsTitle}
        description={t.requestsDesc}
        actions={
          <Button icon="plus" onClick={() => setCreating(true)}>
            {t.newRequest}
          </Button>
        }
        items={requestItems}
        filter={requestFilter}
        onFilterChange={setRequestFilter}
        onOpen={openRequestDetail}
        loading={requests.loading || extensions.loading}
        error={requests.error || extensions.error}
        emptyTitle={t.requestsEmptyTitle}
        emptyDescription={t.requestsEmptyDesc}
        note={t.requestsNote}
      />


      {/* Confirmación del cambio de plan: plan actual, plan nuevo, plazos, fecha efectiva y aviso */}
      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={t.confirmTitle}
        description={t.confirmDesc}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)} disabled={saving}>
              {t.cancel}
            </Button>
            <Button icon="check" onClick={applyPlan} disabled={saving}>
              {saving ? t.applying : t.apply}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="rounded-xl border border-line p-4">
              <div className="text-xs text-muted">{t.currentPlanL}</div>
              <div className="text-sm font-medium text-ink mt-1">{modeLabel(currentMode)}</div>
              <div className="text-xs text-muted mt-1">{t.daysL(currentDays)}</div>
            </div>
            <div className="rounded-xl border border-accent/40 bg-accent-soft p-4">
              <div className="text-xs text-muted">{t.newPlanL}</div>
              <div className="text-sm font-medium text-ink mt-1">{modeLabel(mode)}</div>
              <div className="text-xs text-muted mt-1">{t.daysL(days)}</div>
            </div>
          </div>

          <DetailRow
            label={t.termChangeL}
            value={`${t.daysL(currentDays)} → ${t.daysL(days)}`}
          />
          <DetailRow label={t.effectiveDateL} value={formatDate(effectiveAt, lang)} />

          <p className="text-[13px] text-muted leading-relaxed">
            {t.changesApplyFrom}
            <b className="text-ink">{formatDate(effectiveAt, lang)}</b>
            {t.changesApplyTail(modeLabel(currentMode).toLowerCase(), currentDays)}
          </p>
          <p className="text-xs text-faint leading-relaxed">{t.confirmNote}</p>
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
              ? p.scopeAnonymize
              : p.scopeRecordings
            : p.requestFallback
        }
        description={openRequest ? p.stateL(reqStatus(openRequest.status).label) : ''}
        footer={
          <Button variant="ghost" onClick={() => setOpenRequest(null)}>
            {p.close}
          </Button>
        }
      >
        {openRequest && (
          <div className="space-y-4">
            <DetailRow
              label={d.L.dir.vocero}
              value={
                openRequest.targetUser
                  ? `${openRequest.targetUser.name} · ${displayEmail(openRequest.targetUser)}`
                  : p.wholeOrg
              }
            />
            <DetailRow label={p.requestedL} value={formatDate(openRequest.createdAt, lang)} />
            <DetailRow label={p.reasonL} value={openRequest.reason || p.noReason} />
            <DetailRow
              label={p.resolutionL}
              value={
                openRequest.resolvedAt
                  ? p.resolvedOn(formatDate(openRequest.resolvedAt, lang), openRequest.resolvedBy?.name)
                  : p.pendingSystem
              }
            />
            {openRequest.resolutionNote && <DetailRow label={p.resolutionNoteL} value={openRequest.resolutionNote} />}
            <p className="text-xs text-faint leading-relaxed">{t.readOnlyNote}</p>
          </div>
        )}
      </Modal>

      {/* Detalle (solo lectura) de una solicitud de extensión */}
      <Modal
        open={Boolean(openExtension)}
        onClose={() => setOpenExtension(null)}
        title={t.extTitle}
        description={openExtension ? p.stateL(extStatus(openExtension.status).label) : ''}
        footer={
          <Button variant="ghost" onClick={() => setOpenExtension(null)}>
            {p.close}
          </Button>
        }
      >
        {openExtension && (
          <div className="space-y-4">
            <DetailRow label={t.currentTermAtRequest} value={t.daysL(openExtension.currentDays)} />
            <DetailRow label={t.requestedTerm} value={t.daysL(openExtension.requestedDays)} />
            {openExtension.appliedDays ? (
              <DetailRow label={t.appliedTerm} value={t.daysL(openExtension.appliedDays)} />
            ) : null}
            <DetailRow label={p.requestedL} value={formatDate(openExtension.createdAt, lang)} />
            <DetailRow label={p.reasonL} value={openExtension.reason || p.noReason} />
            <DetailRow
              label={p.resolutionL}
              value={
                openExtension.resolvedAt
                  ? p.resolvedOn(formatDate(openExtension.resolvedAt, lang), openExtension.resolvedBy?.name)
                  : p.pendingSystem
              }
            />
            {openExtension.resolutionNote && <DetailRow label={p.resolutionNoteL} value={openExtension.resolutionNote} />}
            <p className="text-xs text-faint leading-relaxed">{t.extNote}</p>
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