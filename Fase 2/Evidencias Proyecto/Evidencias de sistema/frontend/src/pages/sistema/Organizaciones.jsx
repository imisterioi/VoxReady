import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useI18n } from '../../lib/i18n';
import { SECTORS, formatDate, initialsOf } from '../../data/directory';
import { apiFetch } from '../../lib/api';
import { displayEmail } from '../../lib/displayEmail';
import useApiData from '../../hooks/useApiData';
import Icon from '../../components/Icon';
import UserFormModal from '../../components/UserFormModal';
import { Avatar, Badge, Button, Card, EmptyState, Field, Modal, PageHeader, cx } from '../../components/ui';

// Los sectores se guardan con su VALOR canónico (no se traduce al almacenar): el diccionario solo
// aporta la etiqueta visible de cada valor.
const EMPTY = { name: '', sector: SECTORS[0], adminName: '', adminEmail: '', adminPassword: '' };

function NewTenantModal({ open, onClose, onCreated }) {
  const { d } = useI18n();
  const t = d.L.sys.organizaciones;
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
      toast.success(t.createdToast(tenant.name, admin.email));
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
      title={t.newOrgTitle}
      description={t.newOrgDesc}
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            {t.cancel}
          </Button>
          <Button onClick={submit} icon="check" disabled={saving}>
            {saving ? t.creating : t.createOrg}
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-6">
        <div className="space-y-4">
          <div className="eyebrow">{t.orgEyebrow}</div>
          <div className="grid grid-cols-1 sm:grid-cols-[1.4fr_1fr] gap-4">
            <Field label={t.nameL}>
              <input className="input" value={form.name} onChange={set('name')} placeholder={t.namePh} autoFocus />
            </Field>
            <Field label={t.sectorL}>
              <select className="input" value={form.sector} onChange={set('sector')}>
                {SECTORS.map((s) => (
                  <option key={s} value={s}>
                    {d.L.dir.sectorLabels[s] || s}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </div>

        <div className="space-y-4 pt-5 border-t border-line">
          <div className="eyebrow">{t.adminEyebrow}</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label={t.adminNameL}>
              <input className="input" value={form.adminName} onChange={set('adminName')} placeholder={t.adminNamePh} />
            </Field>
            <Field label={t.emailL}>
              <input className="input" type="email" value={form.adminEmail} onChange={set('adminEmail')} placeholder="nombre@empresa.com" />
            </Field>
          </div>
          <Field label={t.passL} hint={t.passHint}>
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
  const { d, lang } = useI18n();
  const t = d.L.sys.organizaciones;
  const sectorLabels = d.L.dir.sectorLabels;
  const { data, loading, error, reload } = useApiData('/api/tenants');
  const tenants = useMemo(() => data?.tenants || [], [data]);
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [adminFor, setAdminFor] = useState(null);
  const [deletingTenant, setDeletingTenant] = useState(null);
  const [suspendingTenant, setSuspendingTenant] = useState(null);
  const [suspending, setSuspending] = useState(false);
  const [deleting, setDeleting] = useState(false);

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
  const reactivate = async (tn) => {
    try {
      await apiFetch(`/api/tenants/${tn.id}`, { method: 'PATCH', body: { status: 'ACTIVE' } });
      toast.success(t.reactivated(tn.name));
      reload();
    } catch (err) {
      toast.error(err.message);
    }
  };

  // Suspender requiere confirmación: solo aquí se envía la solicitud.
  const confirmSuspend = async () => {
    const tn = suspendingTenant;
    try {
      setSuspending(true);
      await apiFetch(`/api/tenants/${tn.id}`, { method: 'PATCH', body: { status: 'SUSPENDED' } });
      toast.success(t.suspendedToast(tn.name));
      setSuspendingTenant(null);
      reload();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSuspending(false);
    }
  };

  // Eliminación manual (irreversible): procesa los datos del tenant de inmediato o lo deja en DELETING.
  const remove = async () => {
    const tn = deletingTenant;
    try {
      setDeleting(true);
      const res = await apiFetch(`/api/tenants/${tn.id}`, { method: 'DELETE' });
      if (res?.deletion === 'pending') toast.success(t.deletionPending(tn.name));
      else toast.success(t.deletedToast(tn.name));
      setDeletingTenant(null);
      reload();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setDeleting(false);
    }
  };

  // Toda la tarjeta abre el detalle de la organización. Los botones internos (Admin, Suspender,
  // Eliminar) conservan su acción: el clic sobre ellos no dispara la navegación.
  const openDetail = (event, tenant) => {
    if (event.target.closest('a, button')) return;
    navigate(`/sistema/organizaciones/${tenant.id}`);
  };

  const onCardKeyDown = (event, tenant) => {
    // Solo cuando el foco está en la propia tarjeta (no en sus botones) y con Enter/Espacio.
    if (event.target !== event.currentTarget) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    navigate(`/sistema/organizaciones/${tenant.id}`);
  };

  return (
    <>
      <PageHeader
        eyebrow={t.eyebrow}
        title={t.title}
        description={t.sub}
        actions={
          <Button icon="plus" onClick={() => setCreating(true)}>
            {t.newOrg}
          </Button>
        }
      />

      <div className="relative sm:w-72 mb-6">
        <Icon name="search" size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
        <input className="input pl-9" placeholder={t.search} value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>

      {loading && !data ? (
        <Card>
          <EmptyState icon="refresh" title={t.loading} />
        </Card>
      ) : error ? (
        <Card>
          <EmptyState tone="danger" icon="server" title={t.loadFailed} description={error} action={<Button variant="secondary" icon="refresh" onClick={reload}>{t.retry}</Button>} />
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState icon="search" title={t.empty} description={t.emptyDesc} />
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {rows.map((tn) => (
            <Card
              key={tn.id}
              role="link"
              tabIndex={0}
              aria-label={t.viewDetail(tn.name)}
              onClick={(event) => openDetail(event, tn)}
              onKeyDown={(event) => onCardKeyDown(event, tn)}
              className={cx(
                // Interactiva: al pasar el cursor el borde pasa a un color claro y GANA 1px de
                // grosor. El grosor se dibuja con un borde INTERIOR reservado (::after), así la
                // tarjeta no cambia de tamaño ni se desplaza. Sin sombras ni efectos de brillo.
                'relative cursor-pointer transition-colors duration-200 hover:border-line-strong',
                "after:pointer-events-none after:absolute after:inset-0 after:rounded-2xl after:border after:border-line-strong after:opacity-0 after:transition-opacity after:duration-200 after:content-[''] hover:after:opacity-100",
                // Indicador de teclado: anillo suave alrededor de la tarjeta (solo con el foco).
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas',
                tn.status === 'SUSPENDED' && 'opacity-70',
              )}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="h-11 w-11 rounded-xl bg-subtle text-ink font-display font-semibold flex items-center justify-center">
                    {initialsOf(tn.name)}
                  </span>
                  <div className="min-w-0">
                    <h3 className="text-[15px] font-semibold text-ink truncate">{tn.name}</h3>
                    <p className="text-xs text-muted">
                      {tn.sector ? sectorLabels[tn.sector] || tn.sector : t.noSector} · {t.since} {formatDate(tn.createdAt, lang)}
                    </p>
                  </div>
                </div>
                <Badge tone={tn.status === 'ACTIVE' ? 'success' : tn.status === 'DELETING' ? 'neutral' : 'danger'}>
                  {tn.status === 'ACTIVE' ? t.statusActive : tn.status === 'DELETING' ? t.statusDeleting : t.statusSuspended}
                </Badge>
              </div>

              <div className="grid grid-cols-3 gap-3 mt-6">
                {[
                  [t.adminsL, tn.admins.length],
                  [t.vocerosL, tn.voceros],
                  [t.sessionsMonthL, tn.sessionsMonth || 0],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-xl bg-subtle/60 px-3 py-2.5">
                    <div className="text-[11px] text-muted">{label}</div>
                    <div className="text-lg font-semibold text-ink tabular-nums mt-0.5">{value}</div>
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-between gap-3 mt-5 pt-5 border-t border-line">
                <div className="flex -space-x-2">
                  {tn.admins.slice(0, 4).map((a) => (
                    <span key={a.id} title={`${a.name} · ${displayEmail(a)}`} className="ring-2 ring-surface rounded-full">
                      <Avatar initials={initialsOf(a.name)} size="sm" />
                    </span>
                  ))}
                  {tn.admins.length === 0 && <span className="text-xs text-faint">{t.noAdmins}</span>}
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="sm" icon="plus" onClick={() => setAdminFor(tn.id)} disabled={tn.status !== 'ACTIVE'}>
                    {t.adminBtn}
                  </Button>
                  <Button variant="ghost" size="sm" icon={tn.status === 'ACTIVE' ? 'lock' : 'refresh'} onClick={() => (tn.status === 'ACTIVE' ? setSuspendingTenant(tn) : reactivate(tn))} disabled={tn.status === 'DELETING'}>
                    {tn.status === 'ACTIVE' ? t.suspend : t.reactivate}
                  </Button>
                  <Button variant="ghost" size="sm" className="text-danger hover:bg-danger/10" onClick={() => setDeletingTenant(tn)} disabled={tn.status === 'DELETING'}>
                    {t.delete}
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
          onClose={() => (deleting ? null : setDeletingTenant(null))}
          title={t.deleteTitle}
          description={deletingTenant.name}
          footer={
            <>
              <Button variant="ghost" onClick={() => setDeletingTenant(null)} disabled={deleting}>
                {t.cancel}
              </Button>
              <Button variant="danger" icon="trash" onClick={remove} disabled={deleting}>
                {deleting ? t.deleting : t.delete}
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

      {suspendingTenant && (
        <Modal
          open
          onClose={() => (suspending ? null : setSuspendingTenant(null))}
          title={t.suspendTitle}
          description={suspendingTenant.name}
          footer={
            <>
              <Button variant="ghost" onClick={() => setSuspendingTenant(null)} disabled={suspending}>
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

      {adminFor && (
        <UserFormModal
          open
          onClose={() => setAdminFor(null)}
          onCreated={reload}
          allowedRoles={['admin']}
          fixedTenantId={adminFor}
          tenants={tenants}
          title={t.newAdminTitle(tenants.find((tn) => tn.id === adminFor)?.name)}
        />
      )}
    </>
  );
}
