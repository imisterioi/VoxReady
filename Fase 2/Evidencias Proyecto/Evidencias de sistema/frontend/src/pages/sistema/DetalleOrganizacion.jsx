import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useI18n } from '../../lib/i18n';
import { statusMeta, formatDate, initialsOf, timeAgo } from '../../data/directory';
import { apiFetch } from '../../lib/api';
import { displayEmail } from '../../lib/displayEmail';
import useApiData from '../../hooks/useApiData';
import { Avatar, Badge, Button, Card, CardHeader, EmptyState, Field, Modal, PageHeader, Stat, Table } from '../../components/ui';
import RequestsPanel from '../../components/RequestsPanel';
import { buildRequestsFeed } from '../../lib/requestsFeed';

// Tonos de lo que YA gestiona el sistema (no se inventan tipos de solicitud): `DeletionRequest.scope`
// y su máquina de estados (PENDING → APPROVED|REJECTED → COMPLETED). Las etiquetas visibles las aporta
// el diccionario: los códigos internos no se traducen.
const REQUEST_STATUS_TONES = { PENDING: 'accent', APPROVED: 'warning', REJECTED: 'neutral', COMPLETED: 'success' };
const RETENTION_LABEL_KEYS = { FULL: 'retentionFull', METRICS: 'retentionMetrics' };

const numberOr = (value) => (Number.isFinite(value) ? value : '—');

// Detalle de una organización para el Administrador del Sistema: información general, voceros,
// solicitudes de privacidad y estadísticas. Todo sale de endpoints que ya existen
// (`/api/tenants`, `/api/system/jobs`, `/api/users`, `/api/deletion-requests`,
// `/api/metrics/overview`): no se inventan datos ni se añaden modelos.
export default function DetalleOrganizacion() {
  const { d, lang } = useI18n();
  const t = d.L.sys.organizaciones.detalle;
  const p = d.L.privacy;
  // Etiquetas visibles de estados y modos (los valores internos no se traducen).
  const userStatusOf = (value) => statusMeta(d)[value] || { label: value, tone: 'neutral' };
  const tenantStatusOf = (value) => ({
    tone: value === 'ACTIVE' ? 'success' : value === 'SUSPENDED' ? 'danger' : 'neutral',
    label: t.tenantStatus[value] || value,
  });
  const reqStatusOf = (value) => ({
    tone: REQUEST_STATUS_TONES[value] || 'neutral',
    label: p.privacyStatus[value] || value,
  });
  const extStatusOf = (value) => ({
    tone: t.extTones[value] || 'neutral',
    label: p.extensionStatus[value] || value,
  });
  const retentionLabel = (mode) => (mode ? t[RETENTION_LABEL_KEYS[mode]] || mode : mode);
  const scopeLabel = (scope) =>
    scope === 'ANONYMIZE' ? p.scopeAnonymize : scope === 'RECORDINGS' ? p.scopeRecordings : scope;
  const { id } = useParams();
  const query = id ? `tenantId=${encodeURIComponent(id)}` : null;

  const tenants = useApiData('/api/tenants');
  const jobs = useApiData('/api/system/jobs');
  const users = useApiData(query ? `/api/users?${query}` : null);
  const requests = useApiData(query ? `/api/deletion-requests?${query}` : null);
  // Solicitudes de extensión del plazo de retención de esta organización (solo las resuelve SYSTEM).
  const extensions = useApiData(query ? `/api/retention-requests?${query}` : null);
  // Período completo: la vista muestra los datos agregados disponibles de la organización.
  const metrics = useApiData(query ? `/api/metrics/overview?${query}&period=all` : null);

  // Solicitud abierta en la ventana de detalle (privacidad o extensión) + nota de resolución.
  const [openRequest, setOpenRequest] = useState(null);
  const [openExtension, setOpenExtension] = useState(null);
  const [resolutionNote, setResolutionNote] = useState('');
  const [saving, setSaving] = useState(false);
  // Filtro interno del panel único de solicitudes (Todas / Privacidad / Retención).
  const [requestFilter, setRequestFilter] = useState('all');

  const tenant = useMemo(() => (tenants.data?.tenants || []).find((t) => t.id === id) || null, [tenants.data, id]);
  const job = useMemo(() => (jobs.data?.tenants || []).find((t) => t.id === id) || null, [jobs.data, id]);
  const people = useMemo(() => users.data?.users || [], [users.data]);
  const voceros = useMemo(() => people.filter((u) => u.role === 'user'), [people]);
  const admins = useMemo(() => people.filter((u) => u.role === 'admin'), [people]);
  const summary = metrics.data?.summary || null;
  const topVoceros = metrics.data?.voceros?.top || [];
  const preferredThemes = metrics.data?.themes?.preferred || [];

  // Resolver una solicitud de privacidad (SOLO el administrador del sistema; el backend lo exige).
  const resolvePrivacy = async (status) => {
    if (!openRequest) return;
    try {
      setSaving(true);
      await apiFetch(`/api/deletion-requests/${openRequest.id}`, { method: 'PATCH', body: { status, resolutionNote } });
      toast.success(status === 'REJECTED' ? t.privacyRejected : t.privacyUpdated);
      setOpenRequest(null);
      setResolutionNote('');
      requests.reload();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSaving(false);
    }
  };

  // Resolver una solicitud de extensión (aprobar la aplica de inmediato en el backend).
  const resolveExtension = async (status) => {
    if (!openExtension) return;
    try {
      setSaving(true);
      const result = await apiFetch(`/api/retention-requests/${openExtension.id}`, { method: 'PATCH', body: { status, resolutionNote } });
      toast.success(
        status === 'REJECTED'
          ? t.extensionRejected
          : t.extensionApplied(result?.effect?.retentionDays ?? openExtension.requestedDays),
      );
      setOpenExtension(null);
      setResolutionNote('');
      extensions.reload();
      jobs.reload(); // el plazo vigente cambia en la organización
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSaving(false);
    }
  };

  // Panel ÚNICO de solicitudes: los dos tipos se juntan en una sola lista ordenada por fecha.
  // Cada elemento conserva la solicitud original (`raw`) para abrir su ventana de detalle.
  const requestItems = useMemo(
    () =>
      buildRequestsFeed({
        privacy: requests.data?.requests || [],
        extensions: extensions.data?.requests || [],
      }).map((entry) => {
        const r = entry.request;
        if (entry.kind === 'privacy') {
          const st = reqStatusOf(r.status);
          return {
            key: `privacy-${r.id}`,
            kind: 'privacy',
            raw: r,
            title: scopeLabel(r.scope) || r.scope,
            subtitle: [
              r.targetUser ? `${r.targetUser.name} · ${displayEmail(r.targetUser)}` : p.wholeOrg,
              r.reason || p.noReason,
              formatDate(r.createdAt, lang),
            ].join(' · '),
            meta: r.resolvedAt
              ? p.resolvedOn(formatDate(r.resolvedAt, lang), r.resolvedBy?.name)
              : t.requestedBy(r.requestedBy?.name || '—'),
            status: st,
            actionLabel: ['PENDING', 'APPROVED'].includes(r.status) ? t.review : p.view,
          };
        }
        const st = extStatusOf(r.status);
        return {
          key: `retention-${r.id}`,
          kind: 'retention',
          raw: r,
          title: p.extensionRow(r.requestedDays, r.currentDays),
          subtitle: [r.reason || p.noReason, formatDate(r.createdAt, lang)].join(' · '),
          meta: r.resolvedAt
            ? p.resolvedOn(formatDate(r.resolvedAt, lang), r.resolvedBy?.name)
            : t.requestedBy(r.requestedBy?.name || '—'),
          status: st,
          actionLabel: r.status === 'PENDING' ? t.review : p.view,
        };
      }),
    [requests.data, extensions.data, lang],
  );

  // Abrir la ventana de detalle de la solicitud seleccionada (privacidad o extensión).
  const openRequestDetail = (item) => {
    setResolutionNote(item.raw?.resolutionNote || '');
    if (item.kind === 'privacy') setOpenRequest(item.raw);
    else setOpenExtension(item.raw);
  };

  const header = (
    <PageHeader
      eyebrow={t.eyebrow}
      title={tenant?.name || t.orgFallback}
      description={
        tenant
          ? t.headerOf(tenant.sector ? d.L.dir.sectorLabels[tenant.sector] || tenant.sector : t.noSector, formatDate(tenant.createdAt, lang))
          : t.headerSub
      }
      actions={
        <Button to="/sistema/organizaciones" variant="secondary" icon="arrowLeft">
          {t.backToOrgs}
        </Button>
      }
    />
  );

  if (tenants.loading && !tenants.data) {
    return (
      <>
        {header}
        <Card>
          <EmptyState icon="refresh" title={t.loadingL} />
        </Card>
      </>
    );
  }

  if (tenants.error) {
    return (
      <>
        {header}
        <Card>
          <EmptyState
            tone="danger"
            icon="server"
            title={t.loadFailed}
            description={tenants.error}
            action={
              <Button variant="secondary" icon="refresh" onClick={tenants.reload}>
                {t.retry}
              </Button>
            }
          />
        </Card>
      </>
    );
  }

  if (!tenant) {
    return (
      <>
        {header}
        <Card>
          <EmptyState
            icon="search"
            title={t.notFoundTitle}
            description={t.notFoundDesc}
            action={
              <Button to="/sistema/organizaciones" variant="secondary">
                {t.seeOrgs}
              </Button>
            }
          />
        </Card>
      </>
    );
  }

  const tenantStatus = tenantStatusOf(tenant.status);

  return (
    <>
      {header}

      {/* Información general */}
      <Card className="mb-6">
        <CardHeader
          title={t.infoTitle}
          description={t.infoDesc}
          action={<Badge tone={tenantStatus.tone}>{tenantStatus.label}</Badge>}
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Info
            label={t.sectorL}
            value={tenant.sector ? d.L.dir.sectorLabels[tenant.sector] || tenant.sector : t.noSector}
          />
          <Info label={t.createdL} value={formatDate(tenant.createdAt, lang)} />
          <Info
            label={t.retentionL}
            value={job ? t.retentionValue(retentionLabel(job.retentionMode), job.retentionDays) : '—'}
            hint={job ? undefined : t.noJobData}
          />
          <Info
            label={t.openRequestsL}
            value={job ? numberOr(job.openDeletionRequests) : '—'}
            hint={t.openRequestsHint}
          />
        </div>

        {tenant.status === 'DELETING' && (
          <p className="mt-5 text-sm text-muted leading-relaxed">
            {t.deletingNote(job?.deletionRequestedAt ? formatDate(job.deletionRequestedAt, lang) : null)}
          </p>
        )}

        <div className="mt-6 pt-5 border-t border-line">
          <div className="eyebrow mb-3">{t.adminsEyebrow}</div>
          {admins.length === 0 ? (
            <p className="text-sm text-muted">{t.noAdmins}</p>
          ) : (
            <ul className="flex flex-wrap gap-4">
              {admins.map((a) => (
                <li key={a.id} className="flex items-center gap-3">
                  <Avatar initials={initialsOf(a.name)} size="sm" />
                  <div>
                    <div className="text-sm font-medium text-ink">{a.name}</div>
                    <div className="text-xs text-muted">{displayEmail(a)}</div>
                  </div>
                  <Badge tone={userStatusOf(a.status).tone}>
                    {userStatusOf(a.status).label}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      {/* Estadísticas de la organización */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <Stat
          label={t.statVoceros}
          value={voceros.length}
          icon="users"
          hint={t.actives(voceros.filter((v) => v.status === 'ACTIVE').length)}
        />
        <Stat
          label={t.statSessions}
          value={job ? numberOr(job.sessions) : '—'}
          icon="activity"
          hint={t.statSessionsHint}
        />
        <Stat
          label={t.statRecordings}
          value={job ? numberOr(job.recordings) : '—'}
          icon="video"
          hint={t.statRecordingsHint}
        />
        <Stat
          label={t.statAnonymized}
          value={job ? numberOr(job.anonymizedUsers) : '—'}
          icon="shield"
          hint={t.statAnonymizedHint}
        />
      </div>


      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Uso de la plataforma (endpoint de métricas existente, histórico completo) */}
        <Card>
          <CardHeader title={t.usageTitle} description={t.usageDesc} />
          {metrics.loading && !metrics.data ? (
            <EmptyState icon="refresh" title={t.loadingStats} />
          ) : metrics.error ? (
            <EmptyState tone="danger" icon="server" title={t.statsFailed} description={metrics.error} />
          ) : !summary ? (
            <EmptyState icon="chart" title={t.noStats} />
          ) : (
            <div className="space-y-3">
              <MetricRow label={t.mVocerosActive} value={numberOr(summary.vocerosActive)} />
              <MetricRow label={t.mSessions} value={numberOr(summary.sessions)} />
              <MetricRow label={t.mAvgPerVocero} value={numberOr(summary.avgPerVocero)} />
              <MetricRow label={t.mPerWeek} value={numberOr(summary.perWeek)} />
              <MetricRow label={t.mAvgDaysBetween} value={numberOr(summary.avgDaysBetween)} />
              <MetricRow label={t.mConnected} value={numberOr(summary.connected)} />
              <p className="text-xs text-faint pt-2">{t.dashNote}</p>
            </div>
          )}
        </Card>

        <Card>
          <CardHeader title={t.topTitle} description={t.topDesc} />
          {metrics.loading && !metrics.data ? (
            <EmptyState icon="refresh" title={t.loadingRanking} />
          ) : topVoceros.length === 0 ? (
            <EmptyState
              icon="users"
              title={t.noTopTitle}
              description={t.noTopDesc}
            />
          ) : (
            <ul className="divide-y divide-line">
              {topVoceros.map((v) => (
                <li key={v.id} className="flex items-center justify-between gap-4 py-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <Avatar initials={initialsOf(v.name)} size="sm" />
                    <span className="text-sm text-ink truncate">{v.name}</span>
                  </div>
                  <span className="text-sm text-muted tabular-nums">{t.practicesOf(v.sessions)}</span>
                </li>
              ))}
            </ul>
          )}
          {preferredThemes.length > 0 && (
            <div className="mt-5 pt-5 border-t border-line">
              <div className="eyebrow mb-3">{t.preferredThemes}</div>
              <div className="flex flex-wrap gap-2">
                {preferredThemes.map((t) => (
                  <Badge key={t.id} tone="outline">
                    {t.title}: {t.sessions}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </Card>
      </div>


      {/* Voceros (tarjeta con padding interior: la tabla se alinea al borde de la tarjeta sin
          desbordar, como en el resto de VoxReady) */}
      <Card className="mb-6">
        <CardHeader
          title={t.vocerosTitle}
          description={t.vocerosDesc(voceros.length)}
        />
        {users.error ? (
          <EmptyState tone="danger" icon="server" title={t.vocerosLoadFailed} description={users.error} />
        ) : users.loading && !users.data ? (
          <EmptyState icon="refresh" title={t.loadingVoceros} />
        ) : voceros.length === 0 ? (
          <EmptyState icon="users" title={t.noVocerosTitle} description={t.noVocerosDesc} />
        ) : (
          <Table
            columns={[
              { label: t.colVocero },
              { label: t.colArea },
              { label: t.colSessions },
              { label: t.colStatus },
              { label: t.colLastLogin },
            ]}
          >
            {voceros.map((u) => (
              <tr key={u.id} className="hover:bg-subtle/50 transition-colors">
                <td className="py-3.5 px-6">
                  <div className="flex items-center gap-3 min-w-[220px]">
                    <Avatar initials={initialsOf(u.name)} size="sm" />
                    <div className="min-w-0">
                      <div className="font-medium text-ink truncate">{u.name}</div>
                      <div className="text-xs text-muted truncate">{displayEmail(u)}</div>
                    </div>
                  </div>
                </td>
                <td className="py-3.5 px-6">
                  <Badge tone="outline">{u.area ? d.L.dir.areaLabels[u.area] || u.area : '—'}</Badge>
                </td>
                <td className="py-3.5 px-6 text-ink tabular-nums">{u.sessions || 0}</td>
                <td className="py-3.5 px-6 whitespace-nowrap">
                  <Badge tone={userStatusOf(u.status).tone}>
                    {userStatusOf(u.status).label}
                  </Badge>
                </td>
                <td className="py-3.5 px-6 text-xs text-muted whitespace-nowrap">{timeAgo(u.lastLoginAt, d)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>


      {/* Panel ÚNICO de solicitudes: privacidad y extensión del plazo en una sola sección, con
          etiqueta de tipo por fila y filtro interno. Cada fila abre su detalle y las acciones de
          resolución siguen siendo solo del administrador del sistema. */}
      <RequestsPanel
        title={t.requestsTitle}
        description={t.requestsDesc}
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

      {/* Detalle de una solicitud de privacidad: revisar y resolver (solo el administrador del sistema) */}
      <Modal
        open={Boolean(openRequest)}
        onClose={() => setOpenRequest(null)}
        title={openRequest ? scopeLabel(openRequest.scope) || openRequest.scope : t.privacyModalFallback}
        description={openRequest ? p.stateL(reqStatusOf(openRequest.status).label) : ''}
        footer={
          openRequest ? (
            <>
              <Button variant="ghost" onClick={() => setOpenRequest(null)} disabled={saving}>
                {p.close}
              </Button>
              {openRequest.status === 'PENDING' && (
                <>
                  <Button
                    variant="ghost"
                    icon="x"
                    className="text-danger hover:bg-danger/10"
                    onClick={() => resolvePrivacy('REJECTED')}
                    disabled={saving}
                  >
                    {t.reject}
                  </Button>
                  <Button icon="check" onClick={() => resolvePrivacy('APPROVED')} disabled={saving}>
                    {saving ? t.savingL : t.approve}
                  </Button>
                </>
              )}
              {openRequest.status === 'APPROVED' && (
                <Button icon="trash" onClick={() => resolvePrivacy('COMPLETED')} disabled={saving}>
                  {saving ? t.processing : t.completeApply}
                </Button>
              )}
            </>
          ) : null
        }
      >
        {openRequest && (
          <div className="space-y-4">
            <DetailRow label={t.orgL} value={tenant?.name || '—'} />
            <DetailRow
              label={d.L.dir.vocero}
              value={
                openRequest.targetUser
                  ? `${openRequest.targetUser.name} · ${displayEmail(openRequest.targetUser)}`
                  : p.wholeOrg
              }
            />
            <DetailRow label={t.typeL} value={scopeLabel(openRequest.scope) || openRequest.scope} />
            <DetailRow label={p.requestedL} value={formatDate(openRequest.createdAt, lang)} />
            <DetailRow
              label={t.requestedByL}
              value={openRequest.requestedBy ? `${openRequest.requestedBy.name}${t.orgAdminSuffix}` : '—'}
            />
            <DetailRow
              label={p.resolutionL}
              value={
                openRequest.resolvedAt
                  ? p.resolvedOn(formatDate(openRequest.resolvedAt, lang), openRequest.resolvedBy?.name)
                  : t.pendingL
              }
            />
            <DetailRow label={p.reasonL} value={openRequest.reason || p.noReason} />
            {openRequest.resolutionNote && <DetailRow label={p.resolutionNoteL} value={openRequest.resolutionNote} />}

            {['PENDING', 'APPROVED'].includes(openRequest.status) && (
              <Field
                label={p.resolutionNoteL}
                hint={t.noteHint}
              >
                <textarea
                  className="textarea min-h-[80px]"
                  value={resolutionNote}
                  onChange={(event) => setResolutionNote(event.target.value)}
                  placeholder={t.notePh}
                />
              </Field>
            )}

            {openRequest.status === 'APPROVED' && (
              <p className="text-xs text-muted leading-relaxed">
                {t.completeNote}
              </p>
            )}
          </div>
        )}
      </Modal>

      {/* Detalle de una solicitud de extensión: aprobar (aplica ya) o rechazar */}
      <Modal
        open={Boolean(openExtension)}
        onClose={() => setOpenExtension(null)}
        title={t.extTitle}
        description={openExtension ? p.stateL(extStatusOf(openExtension.status).label) : ''}
        footer={
          openExtension ? (
            <>
              <Button variant="ghost" onClick={() => setOpenExtension(null)} disabled={saving}>
                {p.close}
              </Button>
              {openExtension.status === 'PENDING' && (
                <>
                  <Button
                    variant="ghost"
                    icon="x"
                    className="text-danger hover:bg-danger/10"
                    onClick={() => resolveExtension('REJECTED')}
                    disabled={saving}
                  >
                    {t.reject}
                  </Button>
                  <Button icon="check" onClick={() => resolveExtension('APPROVED')} disabled={saving}>
                    {saving ? t.applyingL : t.approveApply}
                  </Button>
                </>
              )}
            </>
          ) : null
        }
      >
        {openExtension && (
          <div className="space-y-4">
            <DetailRow label={t.orgL} value={openExtension.tenant?.name || tenant?.name || '—'} />
            <DetailRow label={t.currentTermAtRequest} value={p.daysL(openExtension.currentDays)} />
            <DetailRow label={t.requestedTerm} value={p.daysL(openExtension.requestedDays)} />
            {openExtension.appliedDays ? (
              <DetailRow label={t.appliedTerm} value={p.daysL(openExtension.appliedDays)} />
            ) : null}
            <DetailRow label={p.requestedL} value={formatDate(openExtension.createdAt, lang)} />
            <DetailRow
              label={t.requestedByL}
              value={
                openExtension.requestedBy ? `${openExtension.requestedBy.name}${t.orgAdminSuffix}` : '—'
              }
            />
            <DetailRow
              label={p.resolutionL}
              value={
                openExtension.resolvedAt
                  ? p.resolvedOn(formatDate(openExtension.resolvedAt, lang), openExtension.resolvedBy?.name)
                  : t.pendingL
              }
            />
            <DetailRow label={p.reasonL} value={openExtension.reason || p.noReason} />
            {openExtension.resolutionNote && <DetailRow label={p.resolutionNoteL} value={openExtension.resolutionNote} />}

            {openExtension.status === 'PENDING' && (
              <>
                <Field label={p.resolutionNoteL} hint={t.noteHintShort}>
                  <textarea
                    className="textarea min-h-[80px]"
                    value={resolutionNote}
                    onChange={(event) => setResolutionNote(event.target.value)}
                    placeholder={t.notePhExt}
                  />
                </Field>
                <p className="text-xs text-muted leading-relaxed">
                  {t.approveExtNote}
                </p>
              </>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}

// Dato simple de la tarjeta de información general.
function Info({ label, value, hint }) {
  return (
    <div className="rounded-xl bg-subtle/60 px-4 py-3">
      <div className="text-[11px] text-muted">{label}</div>
      <div className="text-sm font-medium text-ink mt-0.5">{value}</div>
      {hint && <div className="text-[11px] text-faint mt-1">{hint}</div>}
    </div>
  );
}

// Fila de una métrica del resumen.
function MetricRow({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <span className="text-muted">{label}</span>
      <span className="text-ink font-medium tabular-nums">{value}</span>
    </div>
  );
}


// Fila de dato simple dentro de una ventana de detalle.
function DetailRow({ label, value }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-4">
      <span className="text-xs text-muted sm:w-44 shrink-0">{label}</span>
      <span className="text-sm text-ink break-words min-w-0">{value}</span>
    </div>
  );
}
