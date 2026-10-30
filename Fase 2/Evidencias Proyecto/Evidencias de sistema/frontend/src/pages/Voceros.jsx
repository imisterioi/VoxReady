import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useI18n } from '../lib/i18n';
import { statusMeta, initialsOf, timeAgo } from '../data/directory';
import { apiFetch, getCurrentUser } from '../lib/api';
import { displayEmail } from '../lib/displayEmail';
import useApiData from '../hooks/useApiData';
import UserFormModal from '../components/UserFormModal';
import { Avatar, Badge, Button, Card, EmptyState, Modal, PageHeader, Stat, Table } from '../components/ui';

export default function Voceros() {
  const { d } = useI18n();
  const t = d.L.a6;
  const statuses = statusMeta(d);
  const [creating, setCreating] = useState(false);
  const [deletingUser, setDeletingUser] = useState(null);
  const [suspendingUser, setSuspendingUser] = useState(null);
  const [suspending, setSuspending] = useState(false);

  // El backend devuelve solo los voceros de la organización del admin conectado
  const { data, loading, error, reload } = useApiData('/api/users');
  const voceros = data?.users || [];
  const me = getCurrentUser() || {};
  const tenant = me.tenantId ? { id: me.tenantId, name: me.tenantName } : null;
  const navigate = useNavigate();

  // Toda la fila abre el progreso del vocero (misma ruta y misma autorización que antes).
  // Los botones internos (Suspender/Eliminar) conservan su acción.
  const openProgress = (event, user) => {
    if (event.target.closest('a, button')) return;
    navigate(`/admin/vocero/${user.id}`);
  };

  const active = voceros.filter((u) => u.status === 'ACTIVE').length;
  const suspended = voceros.filter((u) => u.status === 'SUSPENDED').length;
  const sessions = voceros.reduce((sum, u) => sum + (u.sessions || 0), 0);

  // Reactivar (acción directa, sin modal): reanuda la retención si el tenant también está activo.
  const reactivate = async (u) => {
    try {
      await apiFetch(`/api/users/${u.id}`, { method: 'PATCH', body: { status: 'ACTIVE' } });
      toast.success(t.reactivated(u.name));
      reload();
    } catch (err) {
      toast.error(err.message);
    }
  };

  // Suspender requiere confirmación: solo aquí se envía la solicitud.
  const confirmSuspend = async () => {
    const u = suspendingUser;
    try {
      setSuspending(true);
      await apiFetch(`/api/users/${u.id}`, { method: 'PATCH', body: { status: 'SUSPENDED' } });
      toast.success(t.suspendedToast(u.name));
      setSuspendingUser(null);
      reload();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSuspending(false);
    }
  };

  // Eliminación manual (irreversible): procesa los datos del vocero de inmediato.
  const remove = async () => {
    const u = deletingUser;
    try {
      await apiFetch(`/api/users/${u.id}`, { method: 'DELETE' });
      toast.success(t.deletedToast(u.name));
      setDeletingUser(null);
      reload();
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow={tenant ? t.eyebrowWith(tenant.name) : t.eyebrow}
        title={t.title}
        description={t.sub}
        actions={
          <Button icon="plus" onClick={() => setCreating(true)} disabled={!tenant}>
            {t.new}
          </Button>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <Stat label={t.statActive} value={active} icon="users" />
        <Stat label={t.statSuspended} value={suspended} icon="lock" />
        <Stat label={t.statSessions} value={sessions} icon="activity" />
      </div>

      <Card>
        {error ? (
          <EmptyState tone="danger" icon="server" title={t.loadFailed} description={error} />
        ) : loading && !data ? (
          <EmptyState icon="refresh" title={t.loading} />
        ) : voceros.length === 0 ? (
          <EmptyState
            icon="users"
            title={t.empty}
            description={t.emptyDesc}
            action={
              <Button icon="plus" onClick={() => setCreating(true)} disabled={!tenant}>
                {t.new}
              </Button>
            }
          />
        ) : (
          <Table
            columns={[
              { label: t.thVocero },
              { label: t.thArea },
              { label: t.thSessions },
              { label: t.thStatus },
              { label: t.thLastLogin },
              { label: '', align: 'right' },
            ]}
          >
            {voceros.map((u) => (
              <tr
                key={u.id}
                onClick={(event) => openProgress(event, u)}
                // Fila interactiva: solo cambia el fondo (sin iluminar el borde), con transición suave.
                // `focus-within` mantiene el mismo indicador cuando el foco llega por teclado.
                className="cursor-pointer transition-colors duration-200 hover:bg-subtle/60 focus-within:bg-subtle/60"
              >
                <td className="py-3.5 px-6">
                  <div className="flex items-center gap-3 min-w-[220px]">
                    <Avatar initials={initialsOf(u.name)} size="sm" />
                    <div className="min-w-0">
                      {/* Enlace real: teclado y lector de pantalla navegan de forma nativa */}
                      <Link
                        to={`/admin/vocero/${u.id}`}
                        title={t.viewProgress(u.name)}
                        className="block font-medium text-ink truncate rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1 focus-visible:ring-offset-surface"
                      >
                        {u.name}
                      </Link>
                      <div className="text-xs text-muted truncate">{displayEmail(u)}</div>
                    </div>
                  </div>
                </td>
                <td className="py-3.5 px-6">
                  <Badge tone="outline">{u.area ? d.L.dir.areaLabels[u.area] || u.area : '—'}</Badge>
                </td>
                <td className="py-3.5 px-6 text-ink tabular-nums">{u.sessions || 0}</td>
                <td className="py-3.5 px-6 whitespace-nowrap">
                  <Badge tone={statuses[u.status]?.tone || 'neutral'}>{statuses[u.status]?.label || u.status}</Badge>
                </td>
                <td className="py-3.5 px-6 text-xs text-muted whitespace-nowrap">{timeAgo(u.lastLoginAt, d)}</td>
                <td className="py-3.5 px-6 text-right">
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="sm" onClick={() => (u.status === 'SUSPENDED' ? reactivate(u) : setSuspendingUser(u))}>
                      {u.status === 'SUSPENDED' ? t.reactivate : t.suspend}
                    </Button>
                    <Button variant="ghost" size="sm" className="text-danger hover:bg-danger/10" onClick={() => setDeletingUser(u)}>
                      {t.delete}
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {tenant && (
        <UserFormModal
          open={creating}
          onClose={() => setCreating(false)}
          onCreated={reload}
          allowedRoles={['user']}
          fixedTenantId={tenant.id}
          title={t.newTitle}
          description={t.newDesc(tenant.name)}
        />
      )}

      {deletingUser && (
        <Modal
          open
          onClose={() => setDeletingUser(null)}
          title={t.deleteTitle}
          description={deletingUser.name}
          footer={
            <>
              <Button variant="ghost" onClick={() => setDeletingUser(null)}>
                {t.cancel}
              </Button>
              <Button variant="danger" icon="trash" onClick={remove}>
                {t.delete}
              </Button>
            </>
          }
        >
          <p className="text-sm text-muted leading-relaxed">
            {t.deleteBody1}
            <b className="text-ink">{t.deleteBodyStrong}</b>
            {t.deleteBody2}
          </p>
        </Modal>
      )}

      {suspendingUser && (
        <Modal
          open
          onClose={() => (suspending ? null : setSuspendingUser(null))}
          title={t.suspendTitle}
          description={suspendingUser.name}
          footer={
            <>
              <Button variant="ghost" onClick={() => setSuspendingUser(null)} disabled={suspending}>
                {t.cancel}
              </Button>
              <Button onClick={confirmSuspend} disabled={suspending}>
                {suspending ? t.suspending : t.confirmSuspend}
              </Button>
            </>
          }
        >
          <p className="text-sm text-muted">{t.suspendLead}</p>
          <ul className="mt-3 space-y-2 text-sm text-muted list-disc pl-5 leading-relaxed">
            {t.suspendItems.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </Modal>
      )}
    </>
  );
}
