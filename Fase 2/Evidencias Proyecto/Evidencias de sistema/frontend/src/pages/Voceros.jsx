import { useState } from 'react';
import toast from 'react-hot-toast';
import { STATUS_META, initialsOf, timeAgo } from '../data/directory';
import { apiFetch, getCurrentUser } from '../lib/api';
import useApiData from '../hooks/useApiData';
import UserFormModal from '../components/UserFormModal';
import { Avatar, Badge, Button, Card, EmptyState, PageHeader, Stat, Table } from '../components/ui';

export default function Voceros() {
  const [creating, setCreating] = useState(false);

  // El backend devuelve solo los voceros de la organización del admin conectado
  const { data, loading, error, reload } = useApiData('/api/users');
  const voceros = data?.users || [];
  const me = getCurrentUser() || {};
  const tenant = me.tenantId ? { id: me.tenantId, name: me.tenantName } : null;

  const active = voceros.filter((u) => u.status === 'ACTIVE').length;
  const suspended = voceros.filter((u) => u.status === 'SUSPENDED').length;
  const sessions = voceros.reduce((sum, u) => sum + (u.sessions || 0), 0);

  const toggle = async (u) => {
    const next = u.status === 'SUSPENDED' ? 'ACTIVE' : 'SUSPENDED';
    try {
      await apiFetch(`/api/users/${u.id}`, { method: 'PATCH', body: { status: next } });
      toast.success(`${u.name} ${next === 'ACTIVE' ? 'reactivado' : 'suspendido'}`);
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
                  <Button variant="ghost" size="sm" onClick={() => toggle(u)}>
                    {u.status === 'SUSPENDED' ? 'Reactivar' : 'Suspender'}
                  </Button>
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
    </>
  );
}
