import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { STATUS_META, formatDate, initialsOf, timeAgo } from '../../data/directory';
import { apiFetch } from '../../lib/api';
import { displayEmail } from '../../lib/displayEmail';
import useApiData from '../../hooks/useApiData';
import { Avatar, Badge, Button, Card, CardHeader, EmptyState, Field, Modal, PageHeader, Stat, Table } from '../../components/ui';
import RequestsPanel from '../../components/RequestsPanel';
import { buildRequestsFeed } from '../../lib/requestsFeed';

// Etiquetas de lo que YA gestiona el sistema (no se inventan tipos de solicitud):
// `DeletionRequest.scope` y su máquina de estados (PENDING → APPROVED|REJECTED → COMPLETED).
const SCOPE_LABELS = {
  RECORDINGS: 'Borrado de grabaciones',
  ANONYMIZE: 'Anonimización completa',
};
const REQUEST_STATUS = {
  PENDING: { label: 'Pendiente', tone: 'accent' },
  APPROVED: { label: 'Aprobada', tone: 'warning' },
  REJECTED: { label: 'Rechazada', tone: 'neutral' },
  COMPLETED: { label: 'Completada', tone: 'success' },
};
const RETENTION_LABELS = {
  FULL: 'Grabaciones + métricas',
  METRICS: 'Solo métricas',
};
const TENANT_STATUS = {
  ACTIVE: { label: 'Activa', tone: 'success' },
  SUSPENDED: { label: 'Suspendida', tone: 'danger' },
  DELETING: { label: 'Eliminando…', tone: 'neutral' },
};

const numberOr = (value) => (Number.isFinite(value) ? value : '—');

// Estados de una solicitud de extensión del plazo de retención.
const EXTENSION_STATUS = {
  PENDING: { label: 'Pendiente', tone: 'accent' },
  APPROVED: { label: 'Aprobada y aplicada', tone: 'success' },
  REJECTED: { label: 'Rechazada', tone: 'neutral' },
};

// Detalle de una organización para el Administrador del Sistema: información general, voceros,
// solicitudes de privacidad y estadísticas. Todo sale de endpoints que ya existen
// (`/api/tenants`, `/api/system/jobs`, `/api/users`, `/api/deletion-requests`,
// `/api/metrics/overview`): no se inventan datos ni se añaden modelos.
export default function DetalleOrganizacion() {
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
      toast.success(status === 'REJECTED' ? 'Solicitud rechazada' : 'Solicitud actualizada');
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
          ? 'Solicitud de extensión rechazada'
          : `Extensión aplicada: ${result?.effect?.retentionDays ?? openExtension.requestedDays} días`,
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
          const status = REQUEST_STATUS[r.status] || { label: r.status, tone: 'neutral' };
          return {
            key: `privacy-${r.id}`,
            kind: 'privacy',
            raw: r,
            title: SCOPE_LABELS[r.scope] || r.scope,
            subtitle: [
              r.targetUser ? `${r.targetUser.name} · ${displayEmail(r.targetUser)}` : 'Organización completa',
              r.reason || 'Sin motivo indicado',
              formatDate(r.createdAt),
            ].join(' · '),
            meta: r.resolvedAt
              ? `Resuelta el ${formatDate(r.resolvedAt)}${r.resolvedBy?.name ? ` por ${r.resolvedBy.name}` : ''}`
              : `Solicitada por ${r.requestedBy?.name || '—'}`,
            status,
            actionLabel: ['PENDING', 'APPROVED'].includes(r.status) ? 'Revisar' : 'Ver',
          };
        }
        const status = EXTENSION_STATUS[r.status] || { label: r.status, tone: 'neutral' };
        return {
          key: `retention-${r.id}`,
          kind: 'retention',
          raw: r,
          title: `Extensión a ${r.requestedDays} días (vigente: ${r.currentDays})`,
          subtitle: [r.reason || 'Sin motivo indicado', formatDate(r.createdAt)].join(' · '),
          meta: r.resolvedAt
            ? `Resuelta el ${formatDate(r.resolvedAt)}${r.resolvedBy?.name ? ` por ${r.resolvedBy.name}` : ''}`
            : `Solicitada por ${r.requestedBy?.name || '—'}`,
          status,
          actionLabel: r.status === 'PENDING' ? 'Revisar' : 'Ver',
        };
      }),
    [requests.data, extensions.data],
  );

  // Abrir la ventana de detalle de la solicitud seleccionada (privacidad o extensión).
  const openRequestDetail = (item) => {
    setResolutionNote(item.raw?.resolutionNote || '');
    if (item.kind === 'privacy') setOpenRequest(item.raw);
    else setOpenExtension(item.raw);
  };

  const header = (
    <PageHeader
      eyebrow="Administración del sistema · Organización"
      title={tenant?.name || 'Organización'}
      description={
        tenant
          ? `${tenant.sector || 'Sin sector'} · creada el ${formatDate(tenant.createdAt)}`
          : 'Información general, voceros, solicitudes de privacidad y estadísticas.'
      }
      actions={
        <Button to="/sistema/organizaciones" variant="secondary" icon="arrowLeft">
          Volver a organizaciones
        </Button>
      }
    />
  );

  if (tenants.loading && !tenants.data) {
    return (
      <>
        {header}
        <Card>
          <EmptyState icon="refresh" title="Cargando la organización…" />
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
            title="No se pudieron cargar las organizaciones"
            description={tenants.error}
            action={
              <Button variant="secondary" icon="refresh" onClick={tenants.reload}>
                Reintentar
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
            title="Organización no encontrada"
            description="Puede que se haya eliminado. Vuelve a la lista de organizaciones."
            action={
              <Button to="/sistema/organizaciones" variant="secondary">
                Ver organizaciones
              </Button>
            }
          />
        </Card>
      </>
    );
  }

  const status = TENANT_STATUS[tenant.status] || { label: tenant.status, tone: 'neutral' };

  return (
    <>
      {header}

      {/* Información general */}
      <Card className="mb-6">
        <CardHeader
          title="Información general"
          description="Estado, datos de la organización y política de retención vigente."
          action={<Badge tone={status.tone}>{status.label}</Badge>}
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Info label="Sector" value={tenant.sector || 'Sin sector'} />
          <Info label="Creada" value={formatDate(tenant.createdAt)} />
          <Info
            label="Retención de datos"
            value={job ? `${RETENTION_LABELS[job.retentionMode] || job.retentionMode} · ${job.retentionDays} días` : '—'}
            hint={job ? undefined : 'Sin datos del job de retención.'}
          />
          <Info
            label="Solicitudes abiertas"
            value={job ? numberOr(job.openDeletionRequests) : '—'}
            hint="Pendientes o aprobadas sin completar."
          />
        </div>

        {tenant.status === 'DELETING' && (
          <p className="mt-5 text-sm text-muted leading-relaxed">
            Esta organización está en proceso de eliminación
            {job?.deletionRequestedAt ? ` (solicitada el ${formatDate(job.deletionRequestedAt)})` : ''}. Sus datos se
            procesan de inmediato, sin esperar el período de retención.
          </p>
        )}

        <div className="mt-6 pt-5 border-t border-line">
          <div className="eyebrow mb-3">Administradores de la organización</div>
          {admins.length === 0 ? (
            <p className="text-sm text-muted">Esta organización no tiene administradores registrados.</p>
          ) : (
            <ul className="flex flex-wrap gap-4">
              {admins.map((a) => (
                <li key={a.id} className="flex items-center gap-3">
                  <Avatar initials={initialsOf(a.name)} size="sm" />
                  <div>
                    <div className="text-sm font-medium text-ink">{a.name}</div>
                    <div className="text-xs text-muted">{displayEmail(a)}</div>
                  </div>
                  <Badge tone={STATUS_META[a.status]?.tone || 'neutral'}>
                    {STATUS_META[a.status]?.label || a.status}
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
          label="Voceros"
          value={voceros.length}
          icon="users"
          hint={`${voceros.filter((v) => v.status === 'ACTIVE').length} activos`}
        />
        <Stat
          label="Sesiones registradas"
          value={job ? numberOr(job.sessions) : '—'}
          icon="activity"
          hint="Todas las prácticas de la organización."
        />
        <Stat
          label="Grabaciones guardadas"
          value={job ? numberOr(job.recordings) : '—'}
          icon="video"
          hint="Dentro de su plazo de retención."
        />
        <Stat
          label="Voceros anonimizados"
          value={job ? numberOr(job.anonymizedUsers) : '—'}
          icon="shield"
          hint="Datos personales ya eliminados."
        />
      </div>


      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Uso de la plataforma (endpoint de métricas existente, histórico completo) */}
        <Card>
          <CardHeader title="Uso de la plataforma" description="Datos agregados del sistema de métricas (todo el histórico)." />
          {metrics.loading && !metrics.data ? (
            <EmptyState icon="refresh" title="Cargando estadísticas…" />
          ) : metrics.error ? (
            <EmptyState tone="danger" icon="server" title="No se pudieron cargar las estadísticas" description={metrics.error} />
          ) : !summary ? (
            <EmptyState icon="chart" title="Sin estadísticas disponibles" />
          ) : (
            <div className="space-y-3">
              <MetricRow label="Voceros vigentes" value={numberOr(summary.vocerosActive)} />
              <MetricRow label="Prácticas evaluadas" value={numberOr(summary.sessions)} />
              <MetricRow label="Promedio por vocero" value={numberOr(summary.avgPerVocero)} />
              <MetricRow label="Ritmo semanal" value={numberOr(summary.perWeek)} />
              <MetricRow label="Días entre prácticas" value={numberOr(summary.avgDaysBetween)} />
              <MetricRow label="Conectados ahora" value={numberOr(summary.connected)} />
              <p className="text-xs text-faint pt-2">
                «—» significa que el sistema no tiene ese dato: no se calcula ni se estima aquí.
              </p>
            </div>
          )}
        </Card>

        <Card>
          <CardHeader title="Voceros con más prácticas" description="Ranking del sistema de métricas (histórico completo)." />
          {metrics.loading && !metrics.data ? (
            <EmptyState icon="refresh" title="Cargando ranking…" />
          ) : topVoceros.length === 0 ? (
            <EmptyState
              icon="users"
              title="Sin voceros con prácticas"
              description="Todavía no hay prácticas evaluadas en esta organización."
            />
          ) : (
            <ul className="divide-y divide-line">
              {topVoceros.map((v) => (
                <li key={v.id} className="flex items-center justify-between gap-4 py-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <Avatar initials={initialsOf(v.name)} size="sm" />
                    <span className="text-sm text-ink truncate">{v.name}</span>
                  </div>
                  <span className="text-sm text-muted tabular-nums">{v.sessions} práctica(s)</span>
                </li>
              ))}
            </ul>
          )}
          {preferredThemes.length > 0 && (
            <div className="mt-5 pt-5 border-t border-line">
              <div className="eyebrow mb-3">Escenarios más practicados</div>
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
          title="Voceros de la organización"
          description={`${voceros.length} vocero(s) · sesiones completadas por vocero`}
        />
        {users.error ? (
          <EmptyState tone="danger" icon="server" title="No se pudieron cargar los voceros" description={users.error} />
        ) : users.loading && !users.data ? (
          <EmptyState icon="refresh" title="Cargando voceros…" />
        ) : voceros.length === 0 ? (
          <EmptyState icon="users" title="Sin voceros" description="Esta organización todavía no tiene voceros creados." />
        ) : (
          <Table
            columns={[
              { label: 'Vocero' },
              { label: 'Público interno' },
              { label: 'Sesiones' },
              { label: 'Estado' },
              { label: 'Último ingreso' },
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
                  <Badge tone="outline">{u.area || '—'}</Badge>
                </td>
                <td className="py-3.5 px-6 text-ink tabular-nums">{u.sessions || 0}</td>
                <td className="py-3.5 px-6 whitespace-nowrap">
                  <Badge tone={STATUS_META[u.status]?.tone || 'neutral'}>
                    {STATUS_META[u.status]?.label || u.status}
                  </Badge>
                </td>
                <td className="py-3.5 px-6 text-xs text-muted whitespace-nowrap">{timeAgo(u.lastLoginAt)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>


      {/* Panel ÚNICO de solicitudes: privacidad y extensión del plazo en una sola sección, con
          etiqueta de tipo por fila y filtro interno. Cada fila abre su detalle y las acciones de
          resolución siguen siendo solo del administrador del sistema. */}
      <RequestsPanel
        title="Solicitudes"
        description="Solicitudes de privacidad (borrado y anonimización) y de extensión del plazo de retención de esta organización. Ábrelas para revisarlas y resolverlas."
        items={requestItems}
        filter={requestFilter}
        onFilterChange={setRequestFilter}
        onOpen={openRequestDetail}
        loading={requests.loading || extensions.loading}
        error={requests.error || extensions.error}
        emptyTitle="Sin solicitudes"
        emptyDescription="Esta organización no tiene solicitudes de privacidad ni de extensión registradas."
        note="Las solicitudes de privacidad y de extensión del plazo se resuelven aquí, y solo el administrador del sistema puede hacerlo (el backend lo comprueba). El administrador de la organización puede crearlas y consultar su estado desde su apartado de retención."
      />

      {/* Detalle de una solicitud de privacidad: revisar y resolver (solo el administrador del sistema) */}
      <Modal
        open={Boolean(openRequest)}
        onClose={() => setOpenRequest(null)}
        title={openRequest ? SCOPE_LABELS[openRequest.scope] || openRequest.scope : 'Solicitud de privacidad'}
        description={openRequest ? `Estado: ${REQUEST_STATUS[openRequest.status]?.label || openRequest.status}` : ''}
        footer={
          openRequest ? (
            <>
              <Button variant="ghost" onClick={() => setOpenRequest(null)} disabled={saving}>
                Cerrar
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
                    Rechazar
                  </Button>
                  <Button icon="check" onClick={() => resolvePrivacy('APPROVED')} disabled={saving}>
                    {saving ? 'Guardando…' : 'Aprobar'}
                  </Button>
                </>
              )}
              {openRequest.status === 'APPROVED' && (
                <Button icon="trash" onClick={() => resolvePrivacy('COMPLETED')} disabled={saving}>
                  {saving ? 'Procesando…' : 'Completar y aplicar'}
                </Button>
              )}
            </>
          ) : null
        }
      >
        {openRequest && (
          <div className="space-y-4">
            <DetailRow label="Organización" value={tenant?.name || '—'} />
            <DetailRow
              label="Vocero"
              value={
                openRequest.targetUser
                  ? `${openRequest.targetUser.name} · ${displayEmail(openRequest.targetUser)}`
                  : 'Organización completa'
              }
            />
            <DetailRow label="Tipo" value={SCOPE_LABELS[openRequest.scope] || openRequest.scope} />
            <DetailRow label="Solicitada" value={formatDate(openRequest.createdAt)} />
            <DetailRow
              label="Solicitada por"
              value={openRequest.requestedBy ? `${openRequest.requestedBy.name} (administrador de la organización)` : '—'}
            />
            <DetailRow
              label="Resolución"
              value={
                openRequest.resolvedAt
                  ? `${formatDate(openRequest.resolvedAt)}${openRequest.resolvedBy?.name ? ` · ${openRequest.resolvedBy.name}` : ''}`
                  : 'Pendiente'
              }
            />
            <DetailRow label="Motivo" value={openRequest.reason || 'Sin motivo indicado'} />
            {openRequest.resolutionNote && <DetailRow label="Nota de resolución" value={openRequest.resolutionNote} />}

            {['PENDING', 'APPROVED'].includes(openRequest.status) && (
              <Field
                label="Nota de resolución"
                hint="Opcional. Queda registrada en la solicitud. Completar una anonimización no guarda texto libre."
              >
                <textarea
                  className="textarea min-h-[80px]"
                  value={resolutionNote}
                  onChange={(event) => setResolutionNote(event.target.value)}
                  placeholder="Ej. Verificada con el administrador de la organización."
                />
              </Field>
            )}

            {openRequest.status === 'APPROVED' && (
              <p className="text-xs text-muted leading-relaxed">
                Al completar se ejecuta la acción: borrar las grabaciones del vocero o anonimizarlo. Es irreversible.
              </p>
            )}
          </div>
        )}
      </Modal>

      {/* Detalle de una solicitud de extensión: aprobar (aplica ya) o rechazar */}
      <Modal
        open={Boolean(openExtension)}
        onClose={() => setOpenExtension(null)}
        title="Solicitud de extensión del plazo de retención"
        description={openExtension ? `Estado: ${EXTENSION_STATUS[openExtension.status]?.label || openExtension.status}` : ''}
        footer={
          openExtension ? (
            <>
              <Button variant="ghost" onClick={() => setOpenExtension(null)} disabled={saving}>
                Cerrar
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
                    Rechazar
                  </Button>
                  <Button icon="check" onClick={() => resolveExtension('APPROVED')} disabled={saving}>
                    {saving ? 'Aplicando…' : 'Aprobar y aplicar'}
                  </Button>
                </>
              )}
            </>
          ) : null
        }
      >
        {openExtension && (
          <div className="space-y-4">
            <DetailRow label="Organización" value={openExtension.tenant?.name || tenant?.name || '—'} />
            <DetailRow label="Plazo vigente al solicitarla" value={`${openExtension.currentDays} días`} />
            <DetailRow label="Plazo solicitado" value={`${openExtension.requestedDays} días`} />
            {openExtension.appliedDays ? (
              <DetailRow label="Plazo aplicado" value={`${openExtension.appliedDays} días`} />
            ) : null}
            <DetailRow label="Solicitada" value={formatDate(openExtension.createdAt)} />
            <DetailRow
              label="Solicitada por"
              value={
                openExtension.requestedBy ? `${openExtension.requestedBy.name} (administrador de la organización)` : '—'
              }
            />
            <DetailRow
              label="Resolución"
              value={
                openExtension.resolvedAt
                  ? `${formatDate(openExtension.resolvedAt)}${openExtension.resolvedBy?.name ? ` · ${openExtension.resolvedBy.name}` : ''}`
                  : 'Pendiente'
              }
            />
            <DetailRow label="Motivo" value={openExtension.reason || 'Sin motivo indicado'} />
            {openExtension.resolutionNote && <DetailRow label="Nota de resolución" value={openExtension.resolutionNote} />}

            {openExtension.status === 'PENDING' && (
              <>
                <Field label="Nota de resolución" hint="Opcional. Queda registrada en la solicitud.">
                  <textarea
                    className="textarea min-h-[80px]"
                    value={resolutionNote}
                    onChange={(event) => setResolutionNote(event.target.value)}
                    placeholder="Ej. Aprobada por necesidad de auditoría."
                  />
                </Field>
                <p className="text-xs text-muted leading-relaxed">
                  Aprobar aplica el nuevo plazo de inmediato: los datos que ya existen quedan protegidos y la
                  retención no los borrará hasta que se cumpla el plazo extendido.
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
