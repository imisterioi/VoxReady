import { useState } from 'react';
import toast from 'react-hot-toast';
import { AREAS, ROLE_META, createUser } from '../data/directory';
import Icon from './Icon';
import { Button, ChoiceChips, Field, Modal, Radio } from './ui';

const ROLE_HELP = {
  admin: 'Gestiona temas, voceros y la política de retención de una organización.',
  master: 'Staff de VoxReady. Define el patrón de evaluación y revisa casos.',
  system: 'Staff de VoxReady con acceso total a organizaciones y usuarios.',
  user: 'Practica entrevistas en los escenarios asignados por su organización.',
};

const EMPTY = { name: '', email: '', tenantId: '', area: AREAS[0] };

// Formulario para crear usuarios.
// - allowedRoles: roles que quien crea puede asignar.
// - fixedTenantId: si se indica, el usuario queda en esa organización (admin del cliente).
export default function UserFormModal({ open, onClose, allowedRoles, defaultRole, tenants = [], fixedTenantId, title, description }) {
  const [form, setForm] = useState({ ...EMPTY, role: defaultRole || allowedRoles[0], tenantId: fixedTenantId || '' });
  const [error, setError] = useState('');

  const set = (field) => (value) => {
    setForm((f) => ({ ...f, [field]: value }));
    setError('');
  };

  const needsTenant = form.role === 'admin' || form.role === 'user';
  const activeTenants = tenants.filter((t) => t.status === 'ACTIVE');

  const close = () => {
    setForm({ ...EMPTY, role: defaultRole || allowedRoles[0], tenantId: fixedTenantId || '' });
    setError('');
    onClose();
  };

  const submit = (e) => {
    e?.preventDefault();
    try {
      const user = createUser({
        name: form.name,
        email: form.email,
        role: form.role,
        tenantId: fixedTenantId || form.tenantId,
        area: form.area,
      });
      toast.success(`Invitación enviada a ${user.email}`);
      close();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title={title || 'Nuevo usuario'}
      description={description || 'La persona recibirá una invitación por correo para activar su cuenta.'}
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancelar
          </Button>
          <Button onClick={submit} icon="check">
            Crear e invitar
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

        {needsTenant && !fixedTenantId && (
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

        {/* Permite enviar con Enter */}
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  );
}
