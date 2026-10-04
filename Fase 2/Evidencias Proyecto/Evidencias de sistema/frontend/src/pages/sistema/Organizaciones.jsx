import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { SECTORS, formatDate, initialsOf } from '../../data/directory';
import { apiFetch } from '../../lib/api';
import useApiData from '../../hooks/useApiData';
import Icon from '../../components/Icon';
import UserFormModal from '../../components/UserFormModal';
import { Avatar, Badge, Button, Card, EmptyState, Field, Modal, PageHeader } from '../../components/ui';

const EMPTY = { name: '', sector: SECTORS[0], adminName: '', adminEmail: '', adminPassword: '' };

function NewTenantModal({ open, onClose, onCreated }) {
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    setError('');
  };

  const close = () => {
    setForm(EMPTY);
    setError('');
    onClose();
  };

  const submit = async (e) => {
    e?.preventDefault();
    if (saving) return;
    try {
      setSaving(true);
      const { tenant, admin } = await apiFetch('/api/tenants', { method: 'POST', body: form });
      toast.success(`${tenant.name} creada · administrador: ${admin.email}`);
      onCreated?.();
      close();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="Nueva organización"
      description="Crea un cliente y su primer administrador. Luego él podrá crear a sus voceros."
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancelar
          </Button>
          <Button onClick={submit} icon="check" disabled={saving}>
            {saving ? 'Creando…' : 'Crear organización'}
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-6">
        <div className="space-y-4">
          <div className="eyebrow">Organización</div>
          <div className="grid grid-cols-1 sm:grid-cols-[1.4fr_1fr] gap-4">
            <Field label="Nombre">
              <input className="input" value={form.name} onChange={set('name')} placeholder="Ej. Minera del Sur" autoFocus />
            </Field>
            <Field label="Sector">
              <select className="input" value={form.sector} onChange={set('sector')}>
                {SECTORS.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </Field>
          </div>
        </div>

        <div className="space-y-4 pt-5 border-t border-line">
          <div className="eyebrow">Primer administrador</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Nombre completo">
              <input className="input" value={form.adminName} onChange={set('adminName')} placeholder="Ej. Benjamín Vásquez" />
            </Field>
            <Field label="Correo">
              <input className="input" type="email" value={form.adminEmail} onChange={set('adminEmail')} placeholder="nombre@empresa.com" />
            </Field>
          </div>
          <Field label="Contraseña inicial" hint="Mínimo 6 caracteres. Compártela con el administrador para que ingrese.">
            <input className="input" type="password" value={form.adminPassword} onChange={set('adminPassword')} placeholder="••••••••" autoComplete="new-password" />
          </Field>
        </div>

        {error && (
          <p className="flex items-center gap-2 text-[13px] text-danger">
            <Icon name="alert" size={14} />
            {error}
          </p>
        )}
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  );
}

export default function Organizaciones() {
  const { data, loading, error, reload } = useApiData('/api/tenants');
  const tenants = useMemo(() => data?.tenants || [], [data]);
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const [adminFor, setAdminFor] = useState(null);
  const [deletingTenant, setDeletingTenant] = useState(null);
  const [suspendingTenant, setSuspendingTenant] = useState(null);
  const [suspending, setSuspending] = useState(false);

  const creating = params.get('nueva') === '1';
  const setCreating = (v) => setParams(v ? { nueva: '1' } : {}, { replace: true });

  const rows = useMemo(
    () =>
      tenants.filter(
        (t) => t.name.toLowerCase().includes(query.toLowerCase()) || (t.sector || '').toLowerCase().includes(query.toLowerCase()),
      ),
    [tenants, query],
  );

  // Reactivar (acción directa, sin modal).
  const reactivate = async (t) => {
    try {
      await apiFetch(`/api/tenants/${t.id}`, { method: 'PATCH', body: { status: 'ACTIVE' } });
      toast.success(`${t.name} reactivada`);
      reload();
    } catch (err) {
      toast.error(err.message);
    }
  };

  // Suspender requiere confirmación: solo aquí se envía la solicitud.
  const confirmSuspend = async () => {
    const t = suspendingTenant;
    try {
      setSuspending(true);
      await apiFetch(`/api/tenants/${t.id}`, { method: 'PATCH', body: { status: 'SUSPENDED' } });
      toast.success(`${t.name} suspendida`);
      setSuspendingTenant(null);
      reload();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSuspending(false);
    }
  };

  // Eliminación manual (irreversible): procesa los datos del tenant de inmediato.
  const remove = async () => {
    const t = deletingTenant;
    try {
      await apiFetch(`/api/tenants/${t.id}`, { method: 'DELETE' });
      toast.success(`${t.name} eliminada`);
      setDeletingTenant(null);
      reload();
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Administración del sistema"
        title="Organizaciones"
        description="Clientes que usan VoxReady. Cada organización tiene sus propios administradores, voceros y escenarios."
        actions={
          <Button icon="plus" onClick={() => setCreating(true)}>
            Nueva organización
          </Button>
        }
      />

      <div className="relative sm:w-72 mb-6">
        <Icon name="search" size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
        <input className="input pl-9" placeholder="Buscar organización…" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>

      {loading && !data ? (
        <Card>
          <EmptyState icon="refresh" title="Cargando organizaciones…" />
        </Card>
      ) : error ? (
        <Card>
          <EmptyState tone="danger" icon="server" title="No se pudieron cargar" description={error} action={<Button variant="secondary" icon="refresh" onClick={reload}>Reintentar</Button>} />
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState icon="search" title="Sin resultados" description="No hay organizaciones que coincidan con la búsqueda." />
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {rows.map((t) => (
            <Card key={t.id} className={t.status === 'SUSPENDED' ? 'opacity-70' : ''}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="h-11 w-11 rounded-xl bg-subtle text-ink font-display font-semibold flex items-center justify-center">
                    {initialsOf(t.name)}
                  </span>
                  <div className="min-w-0">
                    <h3 className="text-[15px] font-semibold text-ink truncate">{t.name}</h3>
                    <p className="text-xs text-muted">
                      {t.sector || 'Sin sector'} · desde {formatDate(t.createdAt)}
                    </p>
                  </div>
                </div>
                <Badge tone={t.status === 'ACTIVE' ? 'success' : 'danger'}>{t.status === 'ACTIVE' ? 'Activa' : 'Suspendida'}</Badge>
              </div>

              <div className="grid grid-cols-3 gap-3 mt-6">
                {[
                  ['Administradores', t.admins.length],
                  ['Voceros', t.voceros],
                  ['Sesiones (mes)', t.sessionsMonth || 0],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-xl bg-subtle/60 px-3 py-2.5">
                    <div className="text-[11px] text-muted">{label}</div>
                    <div className="text-lg font-semibold text-ink tabular-nums mt-0.5">{value}</div>
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-between gap-3 mt-5 pt-5 border-t border-line">
                <div className="flex -space-x-2">
                  {t.admins.slice(0, 4).map((a) => (
                    <span key={a.id} title={`${a.name} · ${a.email}`} className="ring-2 ring-surface rounded-full">
                      <Avatar initials={initialsOf(a.name)} size="sm" />
                    </span>
                  ))}
                  {t.admins.length === 0 && <span className="text-xs text-faint">Sin administradores</span>}
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="sm" icon="plus" onClick={() => setAdminFor(t.id)} disabled={t.status !== 'ACTIVE'}>
                    Admin
                  </Button>
                  <Button variant="ghost" size="sm" icon={t.status === 'ACTIVE' ? 'lock' : 'refresh'} onClick={() => (t.status === 'ACTIVE' ? setSuspendingTenant(t) : reactivate(t))}>
                    {t.status === 'ACTIVE' ? 'Suspender' : 'Reactivar'}
                  </Button>
                  <Button variant="ghost" size="sm" className="text-danger hover:bg-danger/10" onClick={() => setDeletingTenant(t)}>
                    Eliminar
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <NewTenantModal open={creating} onClose={() => setCreating(false)} onCreated={reload} />

      {deletingTenant && (
        <Modal
          open
          onClose={() => setDeletingTenant(null)}
          title="¿Eliminar este cliente?"
          description={deletingTenant.name}
          footer={
            <>
              <Button variant="ghost" onClick={() => setDeletingTenant(null)}>
                Cancelar
              </Button>
              <Button variant="danger" icon="trash" onClick={remove}>
                Eliminar
              </Button>
            </>
          }
        >
          <p className="text-sm text-muted leading-relaxed">
            Esta acción procesará inmediatamente los datos asociados al tenant y sus usuarios (usuarios, sesiones, grabaciones,
            transcripciones, reports, reviews, temas y configuración) y <b className="text-ink">no esperará al período de retención</b>.
            Es irreversible. Los escenarios generales no se modifican.
          </p>
        </Modal>
      )}

      {suspendingTenant && (
        <Modal
          open
          onClose={() => (suspending ? null : setSuspendingTenant(null))}
          title="¿Suspender esta organización?"
          description={suspendingTenant.name}
          footer={
            <>
              <Button variant="ghost" onClick={() => setSuspendingTenant(null)} disabled={suspending}>
                Cancelar
              </Button>
              <Button onClick={confirmSuspend} disabled={suspending}>
                {suspending ? 'Suspendiendo…' : 'Confirmar suspensión'}
              </Button>
            </>
          }
        >
          <p className="text-sm text-muted">Al suspender esta organización:</p>
          <ul className="mt-3 space-y-2 text-sm text-muted list-disc pl-5 leading-relaxed">
            <li>Todos los usuarios de este tenant perderán el acceso a VoxReady mientras permanezca suspendido.</li>
            <li>Los datos, sesiones, videos, transcripciones e informes de sus voceros se conservarán.</li>
            <li>El plazo de retención de los datos de todos sus voceros quedará pausado durante la suspensión.</li>
            <li>Cuando se reactive la organización, el plazo de retención continuará desde el tiempo restante para los voceros que también estén activos.</li>
            <li>Si un vocero permanece suspendido, su plazo de retención continuará pausado hasta que se reactive su cuenta.</li>
            <li>Esta acción no elimina la organización ni sus datos.</li>
          </ul>
        </Modal>
      )}

      {adminFor && (
        <UserFormModal
          open
          onClose={() => setAdminFor(null)}
          onCreated={reload}
          allowedRoles={['admin']}
          fixedTenantId={adminFor}
          tenants={tenants}
          title={`Nuevo administrador · ${tenants.find((t) => t.id === adminFor)?.name}`}
        />
      )}
    </>
  );
}
