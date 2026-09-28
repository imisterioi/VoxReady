import { useState } from 'react';
import toast from 'react-hot-toast';
import { apiFetch } from '../lib/api';
import { AREAS, ROLE_META } from '../data/directory';
import Icon from './Icon';
import { Button, ChoiceChips, Field, Modal, Radio } from './ui';

const ROLE_HELP = {
  admin: 'Gestiona temas, voceros y la política de retención de una organización.',
  master: 'Staff de VoxReady. Define el patrón de evaluación y revisa casos.',
  system: 'Staff de VoxReady con acceso total a organizaciones y usuarios.',
  user: 'Practica entrevistas en los escenarios asignados por su organización.',
};

const EMPTY = { name: '', email: '', password: '', tenantId: '', area: AREAS[0] };

// Formulario para crear usuarios (POST /api/users).
// - allowedRoles: roles que quien crea puede asignar.
// - fixedTenantId: si se indica, el usuario queda en esa organización.
// - onCreated: se llama tras crear el usuario (para recargar la lista).
export default function UserFormModal({ open, onClose, onCreated, allowedRoles, defaultRole, tenants = [], fixedTenantId, title, description }) {
  const initial = () => ({ ...EMPTY, role: defaultRole || allowedRoles[0], tenantId: fixedTenantId || '' });
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
      toast.success(`Cuenta creada: ${user.email}`);
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
      title={title || 'Nuevo usuario'}
      description={description || 'Comparte el correo y la contraseña inicial con la persona para que pueda ingresar.'}
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancelar
          </Button>
          <Button onClick={submit} icon="check" disabled={saving}>
            {saving ? 'Creando…' : 'Crear usuario'}
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-5">
        {allowedRoles.length > 1 && (
          <Field label="Rol">
            <div className="space-y-2">
              {allowedRoles.map((role) => (
                <Radio
                  key={role}
                  checked={form.role === role}
                  onChange={() => set('role')(role)}
                  title={ROLE_META[role].label}
                  description={ROLE_HELP[role]}
                />
              ))}
            </div>
          </Field>
        )}

        {needsTenant && (
          <Field label="Organización">
            <select className="input" value={form.tenantId} onChange={(e) => set('tenantId')(e.target.value)}>
              <option value="">Selecciona una organización…</option>
              {activeTenants.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </Field>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Nombre completo">
            <input className="input" value={form.name} onChange={(e) => set('name')(e.target.value)} placeholder="Ej. Javiera Mateluna" autoFocus />
          </Field>
          <Field label="Correo">
            <input className="input" type="email" value={form.email} onChange={(e) => set('email')(e.target.value)} placeholder="nombre@empresa.com" />
          </Field>
        </div>

        <Field label="Contraseña inicial" hint="Mínimo 6 caracteres.">
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
              aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
            >
              <Icon name="eye" size={15} />
            </button>
          </div>
        </Field>

        {form.role === 'user' && (
          <Field label="Público interno" hint="Define qué escenarios verá el vocero.">
            <ChoiceChips options={AREAS} value={form.area} onChange={set('area')} />
          </Field>
        )}

        {allowedRoles.includes('admin') && !allowedRoles.includes('user') && (
          <p className="flex items-start gap-2 text-xs text-muted leading-relaxed rounded-xl bg-subtle/70 p-3">
            <Icon name="info" size={14} className="mt-0.5 text-faint" />
            Los voceros los crea el administrador de cada organización desde su panel.
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
