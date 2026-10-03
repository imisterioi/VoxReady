import { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Avatar, Badge, Button, Card, Checkbox, EmptyState, Modal, PageHeader, cx } from '../components/ui';
import { apiFetch } from '../lib/api';
import useApiData from '../hooks/useApiData';
import { initialsOf } from '../data/directory';

const CATEGORY = { CRISIS: 'Crisis', MEDIOS: 'Medios', INSTITUCIONAL: 'Institucional', GENERAL: 'General' };

// Vista de administración de temas del administrador del cliente:
// listar, crear, editar, eliminar y gestionar qué voceros tienen acceso.
export default function Temas() {
  const themesData = useApiData('/api/themes');
  const usersData = useApiData('/api/users');
  const themes = useMemo(() => themesData.data?.themes || [], [themesData.data]);
  const voceros = useMemo(() => (usersData.data?.users || []).filter((u) => u.status === 'ACTIVE'), [usersData.data]);

  const [managing, setManaging] = useState(null); // tema cuyas asignaciones se editan
  const [deleting, setDeleting] = useState(null); // tema que se eliminará

  return (
    <>
      <PageHeader
        eyebrow="Administración"
        title="Temas"
        description="Escenarios de práctica de tu organización. Administra su contenido y decide qué voceros tienen acceso."
        actions={
          <Button to="/admin/tema" icon="plus">
            Crear tema
          </Button>
        }
      />

      {themesData.error ? (
        <Card>
          <EmptyState tone="danger" icon="server" title="No se pudieron cargar los temas" description={themesData.error} />
        </Card>
      ) : themesData.loading && !themesData.data ? (
        <Card>
          <EmptyState icon="refresh" title="Cargando temas…" />
        </Card>
      ) : themes.length === 0 ? (
        <Card>
          <EmptyState
            icon="file"
            title="Aún no hay temas"
            description="Crea el primer escenario de práctica para tu organización."
            action={
              <Button to="/admin/tema" icon="plus">
                Crear tema
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {themes.map((th) => (
            <Card key={th.id} className="flex flex-col">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h3 className="text-[15px] font-semibold text-ink truncate">{th.title}</h3>
                  <p className="text-[13px] text-muted mt-1 line-clamp-2">{th.context}</p>
                </div>
                <Badge tone="outline">{CATEGORY[th.category] || th.category}</Badge>
              </div>

              <div className="flex flex-wrap items-center gap-2 mt-4">
                <Badge tone="brand" icon="users">
                  {th.availableToAllVoceros ? 'Todos los voceros' : `${th.voceroIds.length} vocero(s) con acceso`}
                </Badge>
                <Badge tone="neutral" icon="activity">{th.sessions} sesión(es)</Badge>
              </div>

              <div className="flex flex-wrap items-center gap-1 mt-5 pt-4 border-t border-line">
                <Button variant="ghost" size="sm" icon="users" onClick={() => setManaging(th)}>
                  Gestionar voceros
                </Button>
                <Button variant="ghost" size="sm" icon="sliders" to={`/admin/tema?id=${th.id}`}>
                  Editar
                </Button>
                <Button variant="ghost" size="sm" icon="trash" className="text-danger hover:bg-danger/10" onClick={() => setDeleting(th)}>
                  Eliminar
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {managing && (
        <ManageVocerosModal
          theme={managing}
          voceros={voceros}
          onClose={() => setManaging(null)}
          onSaved={() => {
            setManaging(null);
            themesData.reload();
          }}
        />
      )}

      {deleting && (
        <DeleteThemeModal
          theme={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            setDeleting(null);
            themesData.reload();
          }}
        />
      )}
    </>
  );
}

// ------------------------------------------------ Gestionar voceros con acceso

function ManageVocerosModal({ theme, voceros, onClose, onSaved }) {
  const [all, setAll] = useState(Boolean(theme.availableToAllVoceros));
  const [ids, setIds] = useState(theme.voceroIds || []);
  const [saving, setSaving] = useState(false);

  const toggle = (id) => setIds((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));

  const save = async () => {
    try {
      setSaving(true);
      await apiFetch(`/api/themes/${theme.id}/assignments`, {
        method: 'PUT',
        body: { voceroIds: all ? [] : ids, availableToAllVoceros: all },
      });
      toast.success('Acceso actualizado');
      onSaved();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Gestionar voceros"
      description={theme.title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button icon="check" onClick={save} disabled={saving}>
            {saving ? 'Guardando…' : 'Guardar cambios'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-xl border border-line bg-surface p-4">
          <Checkbox checked={all} onChange={setAll}>
            <span className="font-medium text-ink">Disponible para todos los voceros</span>
            <span className="block text-xs text-muted mt-0.5">Toda la organización podrá practicar este tema.</span>
          </Checkbox>
        </div>

        <div className={cx('rounded-xl border border-line divide-y divide-line max-h-72 overflow-y-auto', all && 'opacity-40 pointer-events-none')}>
          {voceros.map((v) => (
            <label key={v.id} className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-subtle/50">
              <input type="checkbox" checked={ids.includes(v.id)} onChange={() => toggle(v.id)} />
              <Avatar initials={initialsOf(v.name)} size="sm" />
              <span className="flex-1 min-w-0">
                <span className="block text-sm text-ink truncate">{v.name}</span>
                <span className="block text-xs text-muted truncate">{v.email}</span>
              </span>
              {v.area && <Badge tone="outline">{v.area}</Badge>}
            </label>
          ))}
          {voceros.length === 0 && <p className="px-4 py-3 text-sm text-muted">Aún no hay voceros activos en tu organización.</p>}
        </div>
        <p className="text-xs text-faint">{ids.length} vocero(s) seleccionado(s)</p>
      </div>
    </Modal>
  );
}

// -------------------------------------------------------------- Eliminar tema

function DeleteThemeModal({ theme, onClose, onDeleted }) {
  const [saving, setSaving] = useState(false);

  const confirm = async () => {
    try {
      setSaving(true);
      await apiFetch(`/api/themes/${theme.id}`, { method: 'DELETE' });
      toast.success('Tema eliminado');
      onDeleted();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Eliminar tema"
      description={theme.title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="danger" icon="trash" onClick={confirm} disabled={saving}>
            {saving ? 'Eliminando…' : 'Eliminar tema'}
          </Button>
        </>
      }
    >
      <p className="text-sm text-muted leading-relaxed">
        El tema dejará de estar disponible para practicar. El histórico se conserva: las sesiones, informes y grabaciones
        ya realizadas se mantienen y siguen sujetos a tu política de retención.
      </p>
    </Modal>
  );
}
