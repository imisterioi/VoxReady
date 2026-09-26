import { useState } from 'react';
import toast from 'react-hot-toast';
import { STATUS_META, findUserByEmail, initialsOf, setUserStatus, timeAgo, useDirectory } from '../data/directory';
import UserFormModal from '../components/UserFormModal';
import { Avatar, Badge, Button, Card, EmptyState, PageHeader, Stat, Table } from '../components/ui';

export default function Voceros() {
  const { users, tenants } = useDirectory();
  const [creating, setCreating] = useState(false);

  // Organización del administrador conectado
  const me = JSON.parse(localStorage.getItem('voxready_user') || '{}');
  const tenantId = findUserByEmail(me.email || '')?.tenantId;
  const tenant = tenants.find((t) => t.id === tenantId);
  const voceros = users.filter((u) => u.tenantId === tenantId && u.role === 'user');

  const active = voceros.filter((u) => u.status === 'ACTIVE').length;
  const invited = voceros.filter((u) => u.status === 'INVITED').length;
  const sessions = voceros.reduce((sum, u) => sum + (u.sessions || 0), 0);

  const toggle = (u) => {
    const next = u.status === 'SUSPENDED' ? 'ACTIVE' : 'SUSPENDED';
    setUserStatus(u.id, next);
    toast.success(`${u.name} ${next === 'ACTIVE' ? 'reactivado' : 'suspendido'}`);
  };

  return (
    <>
      <PageHeader
        eyebrow={tenant ? `Administración · ${tenant.name}` : 'Administración'}
        title="Voceros"
        description="Personas de tu organización que practican en VoxReady. Al crearlas reciben una invitación por correo."
        actions={
          <Button icon="plus" onClick={() => setCreating(true)} disabled={!tenant}>
            Nuevo vocero
          </Button>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <Stat label="Voceros activos" value={active} icon="users" />
        <Stat label="Invitaciones pendientes" value={invited} icon="clock" />
        <Stat label="Sesiones realizadas" value={sessions} icon="activity" />
      </div>

      <Card>
        {voceros.length === 0 ? (
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
              { label: 'Última actividad' },
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
                  <Badge tone={STATUS_META[u.status].tone}>{STATUS_META[u.status].label}</Badge>
                </td>
                <td className="py-3.5 px-6 text-xs text-muted whitespace-nowrap">{timeAgo(u.lastActive)}</td>
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
          allowedRoles={['user']}
          fixedTenantId={tenant.id}
          tenants={tenants}
          title="Nuevo vocero"
          description={`Se agregará a ${tenant.name} y recibirá una invitación por correo.`}
        />
      )}
    </>
  );
}
