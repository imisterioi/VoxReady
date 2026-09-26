import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ROLE_META, STATUS_META, initialsOf, setUserStatus, timeAgo, useDirectory } from '../../data/directory';
import Icon from '../../components/Icon';
import UserFormModal from '../../components/UserFormModal';
import { Avatar, Badge, Button, Card, EmptyState, PageHeader, Segmented, Table } from '../../components/ui';

const ROLE_FILTERS = [
  { value: 'all', label: 'Todos' },
  { value: 'user', label: 'Voceros' },
  { value: 'admin', label: 'Admins. cliente' },
  { value: 'staff', label: 'Staff VoxReady' },
];

export default function Usuarios() {
  const { users, tenants } = useDirectory();
  const [params, setParams] = useSearchParams();
  const [roleFilter, setRoleFilter] = useState('all');
  const [tenantFilter, setTenantFilter] = useState('all');
  const [query, setQuery] = useState('');

  const me = JSON.parse(localStorage.getItem('voxready_user') || '{}');
  const creating = params.get('nuevo') === '1';
  const setCreating = (v) => setParams(v ? { nuevo: '1' } : {}, { replace: true });

  const tenantName = (id) => tenants.find((t) => t.id === id)?.name;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return users.filter((u) => {
      const matchesRole =
        roleFilter === 'all' || (roleFilter === 'staff' ? u.role === 'master' || u.role === 'system' : u.role === roleFilter);
      const matchesTenant = tenantFilter === 'all' || (tenantFilter === 'staff' ? !u.tenantId : u.tenantId === tenantFilter);
      const matchesQuery = !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
      return matchesRole && matchesTenant && matchesQuery;
    });
  }, [users, roleFilter, tenantFilter, query]);

  const toggle = (u) => {
    const next = u.status === 'SUSPENDED' ? 'ACTIVE' : 'SUSPENDED';
    setUserStatus(u.id, next);
    toast.success(`${u.name} ${next === 'ACTIVE' ? 'reactivado' : 'suspendido'}`);
  };

  return (
    <>
      <PageHeader
        eyebrow="Administración del sistema"
        title="Usuarios"
        description="Todas las cuentas de la plataforma. Aquí se crean los administradores de cada cliente y el staff de VoxReady."
        actions={
          <Button icon="plus" onClick={() => setCreating(true)}>
            Nuevo usuario
          </Button>
        }
      />

      <div className="flex flex-col lg:flex-row lg:items-center gap-3 mb-6">
        <Segmented options={ROLE_FILTERS} value={roleFilter} onChange={setRoleFilter} />
        <div className="flex flex-col sm:flex-row gap-3 lg:ml-auto">
          <select className="input sm:w-52" value={tenantFilter} onChange={(e) => setTenantFilter(e.target.value)}>
            <option value="all">Todas las organizaciones</option>
            <option value="staff">Staff VoxReady</option>
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <div className="relative sm:w-64">
            <Icon name="search" size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
            <input className="input pl-9" placeholder="Buscar por nombre o correo…" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
        </div>
      </div>

      <Card>
        <div className="flex items-center justify-between mb-4">
          <span className="text-sm text-muted">
            <b className="text-ink font-semibold tabular-nums">{filtered.length}</b> de {users.length} usuarios
          </span>
        </div>

        {filtered.length === 0 ? (
          <EmptyState icon="users" title="Sin resultados" description="Ajusta los filtros o la búsqueda." />
        ) : (
          <Table
            columns={[
              { label: 'Usuario' },
              { label: 'Rol' },
              { label: 'Organización' },
              { label: 'Estado' },
              { label: 'Última actividad' },
              { label: '', align: 'right' },
            ]}
          >
            {filtered.map((u) => {
              const isMe = u.email === me.email;
              return (
                <tr key={u.id} className="hover:bg-subtle/50 transition-colors">
                  <td className="py-3.5 px-6">
                    <div className="flex items-center gap-3 min-w-[220px]">
                      <Avatar initials={initialsOf(u.name)} size="sm" />
                      <div className="min-w-0">
                        <div className="font-medium text-ink truncate">
                          {u.name} {isMe && <span className="text-xs text-faint font-normal">(tú)</span>}
                        </div>
                        <div className="text-xs text-muted truncate">{u.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="py-3.5 px-6 whitespace-nowrap">
                    <Badge tone={ROLE_META[u.role].tone}>{ROLE_META[u.role].short}</Badge>
                  </td>
                  <td className="py-3.5 px-6 text-muted whitespace-nowrap">
                    {u.tenantId ? tenantName(u.tenantId) : <span className="text-faint">VoxReady</span>}
                  </td>
                  <td className="py-3.5 px-6 whitespace-nowrap">
                    <span className="inline-flex items-center gap-1.5 text-xs text-muted">
                      <span
                        className={`h-2 w-2 rounded-full ${u.status === 'ACTIVE' ? 'bg-success' : u.status === 'INVITED' ? 'bg-warning' : 'bg-danger'}`}
                      />
                      {STATUS_META[u.status].label}
                    </span>
                  </td>
                  <td className="py-3.5 px-6 text-xs text-muted whitespace-nowrap">{timeAgo(u.lastActive)}</td>
                  <td className="py-3.5 px-6 text-right">
                    {!isMe && (
                      <Button variant="ghost" size="sm" onClick={() => toggle(u)}>
                        {u.status === 'SUSPENDED' ? 'Reactivar' : 'Suspender'}
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>

      <UserFormModal
        open={creating}
        onClose={() => setCreating(false)}
        allowedRoles={['admin', 'master', 'system']}
        tenants={tenants}
      />
    </>
  );
}
