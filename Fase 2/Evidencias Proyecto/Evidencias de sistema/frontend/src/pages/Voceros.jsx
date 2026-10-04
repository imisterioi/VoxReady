import { useState } from 'react';
import toast from 'react-hot-toast';
import { STATUS_META, initialsOf, timeAgo } from '../data/directory';
import { apiFetch, getCurrentUser } from '../lib/api';
import useApiData from '../hooks/useApiData';
import UserFormModal from '../components/UserFormModal';
import { Avatar, Badge, Button, Card, EmptyState, Modal, PageHeader, Stat, Table } from '../components/ui';

export default function Voceros() {
  const [creating, setCreating] = useState(false);
  const [deletingUser, setDeletingUser] = useState(null);
  const [suspendingUser, setSuspendingUser] = useState(null);
  const [suspending, setSuspending] = useState(false);

  // El backend devuelve solo los voceros de la organización del admin conectado
  const { data, loading, error, reload } = useApiData('/api/users');
  const voceros = data?.users || [];
  const me = getCurrentUser() || {};
  const tenant = me.tenantId ? { id: me.tenantId, name: me.tenantName } : null;

  const active = voceros.filter((u) => u.status === 'ACTIVE').length;
  const suspended = voceros.filter((u) => u.status === 'SUSPENDED').length;
  const sessions = voceros.reduce((sum, u) => sum + (u.sessions || 0), 0);

  // Reactivar (acción directa, sin modal): reanuda la retención si el tenant también está activo.
  const reactivate = async (u) => {
    try {
      await apiFetch(`/api/users/${u.id}`, { method: 'PATCH', body: { status: 'ACTIVE' } });
      toast.success(`${u.name} reactivado`);
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
      toast.success(`${u.name} suspendido`);
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
      toast.success(`${u.name} eliminado`);
      setDeletingUser(null);
      reload();
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow={tenant ? `Administración · ${tenant.name}` : 'Administración'}
        title="Voceros"
        description="Personas de tu organización que practican en VoxReady. Al crearlas les asignas una contraseña inicial."
        actions={
          <Button icon="plus" onClick={() => setCreating(true)} disabled={!tenant}>
            Nuevo vocero
          </Button>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <Stat label="Voceros activos" value={active} icon="users" />
        <Stat label="Suspendidos" value={suspended} icon="lock" />
        <Stat label="Sesiones realizadas" value={sessions} icon="activity" />
      </div>

      <Card>
        {error ? (
          <EmptyState tone="danger" icon="server" title="No se pudieron cargar los voceros" description={error} />
        ) : loading && !data ? (
          <EmptyState icon="refresh" title="Cargando voceros…" />
        ) : voceros.length === 0 ? (
          <EmptyState
            icon="users"
            title="Aún no hay voceros"
            description="Crea el primero para que pueda empezar a practicar."
            action={
              <Button icon="plus" onClick={() => setCreating(true)} disabled={!tenant}>
                Nuevo vocero
              </Button>
            }
          />
        ) : (
          <Table
            columns={[
              { label: 'Vocero' },
              { label: 'Público interno' },
              { label: 'Sesiones' },
              { label: 'Estado' },
              { label: 'Último ingreso' },
              { label: '', align: 'right' },
            ]}
          >
            {voceros.map((u) => (
              <tr key={u.id} className="hover:bg-subtle/50 transition-colors">
                <td className="py-3.5 px-6">
                  <div className="flex items-center gap-3 min-w-[220px]">
                    <Avatar initials={initialsOf(u.name)} size="sm" />
                    <div className="min-w-0">
                      <div className="font-medium text-ink truncate">{u.name}</div>
                      <div className="text-xs text-muted truncate">{u.email}</div>
                    </div>
                  </div>
                </td>
                <td className="py-3.5 px-6">
                  <Badge tone="outline">{u.area || '—'}</Badge>
                </td>
                <td className="py-3.5 px-6 text-ink tabular-nums">{u.sessions || 0}</td>
                <td className="py-3.5 px-6 whitespace-nowrap">
                  <Badge tone={STATUS_META[u.status]?.tone || 'neutral'}>{STATUS_META[u.status]?.label || u.status}</Badge>
                </td>
                <td className="py-3.5 px-6 text-xs text-muted whitespace-nowrap">{timeAgo(u.lastLoginAt)}</td>
                <td className="py-3.5 px-6 text-right">
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="sm" onClick={() => (u.status === 'SUSPENDED' ? reactivate(u) : setSuspendingUser(u))}>
                      {u.status === 'SUSPENDED' ? 'Reactivar' : 'Suspender'}
                    </Button>
                    <Button variant="ghost" size="sm" className="text-danger hover:bg-danger/10" onClick={() => setDeletingUser(u)}>
                      Eliminar
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
          title="Nuevo vocero"
          description={`Se agregará a ${tenant.name}. Comparte su correo y contraseña inicial para que pueda ingresar.`}
        />
      )}

      {deletingUser && (
        <Modal
          open
          onClose={() => setDeletingUser(null)}
          title="¿Eliminar este vocero?"
          description={deletingUser.name}
          footer={
            <>
              <Button variant="ghost" onClick={() => setDeletingUser(null)}>
                Cancelar
              </Button>
              <Button variant="danger" icon="trash" onClick={remove}>
                Eliminar
              </Button>
            </>
          }
        >
          <p className="text-sm text-muted leading-relaxed">
            Esta acción eliminará o anonimizará sus datos inmediatamente (datos personales, grabaciones, transcripciones y
            contenido sensible del report) y <b className="text-ink">no esperará al período de retención</b>. Es irreversible.
          </p>
        </Modal>
      )}

      {suspendingUser && (
        <Modal
          open
          onClose={() => (suspending ? null : setSuspendingUser(null))}
          title="¿Suspender a este vocero?"
          description={suspendingUser.name}
          footer={
            <>
              <Button variant="ghost" onClick={() => setSuspendingUser(null)} disabled={suspending}>
                Cancelar
              </Button>
              <Button onClick={confirmSuspend} disabled={suspending}>
                {suspending ? 'Suspendiendo…' : 'Confirmar suspensión'}
              </Button>
            </>
          }
        >
          <p className="text-sm text-muted">Al suspender esta cuenta:</p>
          <ul className="mt-3 space-y-2 text-sm text-muted list-disc pl-5 leading-relaxed">
            <li>El vocero perderá el acceso a VoxReady mientras permanezca suspendido.</li>
            <li>Sus datos, sesiones, videos, transcripciones e informes se conservarán.</li>
            <li>El plazo de retención de sus datos quedará pausado durante la suspensión.</li>
            <li>Cuando se reactive la cuenta, el plazo de retención continuará desde el tiempo restante, siempre que su tenant también esté activo.</li>
            <li>Esta acción no elimina la cuenta ni sus datos.</li>
          </ul>
        </Modal>
      )}
    </>
  );
}
