import { useState } from 'react';
import toast from 'react-hot-toast';
import { useI18n } from '../lib/i18n';
import { apiFetch } from '../lib/api';
import { AREAS, roleMeta } from '../data/directory';
import Icon from './Icon';
import { Button, ChoiceChips, Field, Modal, Radio } from './ui';

// Formulario para crear usuarios (POST /api/users).
// - allowedRoles: roles que quien crea puede asignar.
// - fixedTenantId: si se indica, el usuario queda en esa organización.
// - onCreated: se llama tras crear el usuario (para recargar la lista).
export default function UserFormModal({ open, onClose, onCreated, allowedRoles, defaultRole, tenants = [], fixedTenantId, title, description }) {
  const { d } = useI18n();
  const t = d.L.userForm;
  const roles = roleMeta(d);
  const areaOptions = AREAS;
  const initial = () => ({ name: '', email: '', password: '', tenantId: fixedTenantId || '', area: areaOptions[0], role: defaultRole || allowedRoles[0] });
  const [form, setForm] = useState(initial);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const set = (field) => (value) => {
    setForm((f) => ({ ...f, [field]: value }));
    setError('');
  };

  const needsTenant = form.role === 'admin' && !fixedTenantId;
  const activeTenants = tenants.filter((t) => t.status === 'ACTIVE');

  const close = () => {
    setForm(initial());
    setError('');
    onClose();
  };

  const submit = async (e) => {
    e?.preventDefault();
    if (saving) return;
    try {
      setSaving(true);
      const { user } = await apiFetch('/api/users', {
        method: 'POST',
        body: {
          name: form.name,
          email: form.email,
          password: form.password,
          role: form.role,
          tenantId: fixedTenantId || form.tenantId || undefined,
          area: form.role === 'user' ? form.area : undefined,
        },
      });
      toast.success(t.createdToast(user.email));
      onCreated?.(user);
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
      title={title || t.defaultTitle}
      description={description || t.defaultDesc}
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            {t.cancel}
          </Button>
          <Button onClick={submit} icon="check" disabled={saving}>
            {saving ? t.creating : t.create}
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-5">
        {allowedRoles.length > 1 && (
          <Field label={t.roleL}>
            <div className="space-y-2">
              {allowedRoles.map((role) => (
                <Radio
                  key={role}
                  checked={form.role === role}
                  onChange={() => set('role')(role)}
                  title={roles[role].label}
                  description={t.roleHelp[role]}
                />
              ))}
            </div>
          </Field>
        )}

        {needsTenant && (
          <Field label={t.orgL}>
            <select className="input" value={form.tenantId} onChange={(e) => set('tenantId')(e.target.value)}>
              <option value="">{t.selectOrg}</option>
              {activeTenants.map((tn) => (
                <option key={tn.id} value={tn.id}>
                  {tn.name}
                </option>
              ))}
            </select>
          </Field>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label={t.nameL}>
            <input className="input" value={form.name} onChange={(e) => set('name')(e.target.value)} placeholder={t.namePh} autoFocus />
          </Field>
          <Field label={t.emailL}>
            <input className="input" type="email" value={form.email} onChange={(e) => set('email')(e.target.value)} placeholder={t.emailPh} />
          </Field>
        </div>

        <Field label={t.passL} hint={t.passHint}>
          <div className="relative">
            <input
              className="input pr-10"
              type={showPassword ? 'text' : 'password'}
              value={form.password}
              onChange={(e) => set('password')(e.target.value)}
              placeholder="••••••••"
              autoComplete="new-password"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 h-7 w-7 rounded-md flex items-center justify-center text-faint hover:text-ink"
              aria-label={showPassword ? t.hidePass : t.showPass}
            >
              <Icon name="eye" size={15} />
            </button>
          </div>
        </Field>

        {form.role === 'user' && (
          <Field label={t.areaL} hint={t.areaHint}>
            <ChoiceChips options={areaOptions} labels={d.L.dir.areaLabels} value={form.area} onChange={set('area')} />
          </Field>
        )}

        {allowedRoles.includes('admin') && !allowedRoles.includes('user') && (
          <p className="flex items-start gap-2 text-xs text-muted leading-relaxed rounded-xl bg-subtle/70 p-3">
            <Icon name="info" size={14} className="mt-0.5 text-faint" />
            {t.adminNote}
          </p>
        )}

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
