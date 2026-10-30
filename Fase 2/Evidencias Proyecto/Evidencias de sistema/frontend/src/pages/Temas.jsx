import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useI18n } from '../lib/i18n';
import { Avatar, Badge, Button, Card, Checkbox, EmptyState, Modal, PageHeader, cx } from '../components/ui';
import { apiFetch } from '../lib/api';
import { displayEmail } from '../lib/displayEmail';
import useApiData from '../hooks/useApiData';
import { initialsOf } from '../data/directory';

// Vista de administración de temas del administrador del cliente:
// listar, crear, editar, eliminar y gestionar qué voceros tienen acceso.
// En "Generales" ve la biblioteca de VoxReady y puede copiar un escenario para adaptarlo.
export default function Temas() {
  const { d } = useI18n();
  const t = d.L.a5;
  const tabs = [
    { value: 'org', label: t.tabs.org },
    { value: 'general', label: t.tabs.general },
  ];
  const themesData = useApiData('/api/themes');
  const usersData = useApiData('/api/users');
  const themes = useMemo(() => themesData.data?.themes || [], [themesData.data]);
  const voceros = useMemo(() => (usersData.data?.users || []).filter((u) => u.status === 'ACTIVE'), [usersData.data]);

  const [managing, setManaging] = useState(null); // tema cuyas asignaciones se editan
  const [deleting, setDeleting] = useState(null); // tema que se eliminará
  const [tab, setTab] = useState('org');

  return (
    <>
      <PageHeader
        eyebrow={t.eyebrow}
        title={t.title}
        description={t.sub}
        actions={
          <Button to="/admin/tema" icon="plus">
            {t.create}
          </Button>
        }
      />

      <div className="flex items-end gap-6 border-b border-line mb-6" role="tablist" aria-label={t.title}>
        {tabs.map((tab) => (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={tab === tab.value}
            onClick={() => setTab(tab.value)}
            className={cx(
              '-mb-px h-11 inline-flex items-center gap-2 border-b-2 px-1 text-sm font-medium transition-colors',
              tab === tab.value ? 'border-accent text-ink' : 'border-transparent text-muted hover:text-ink',
            )}
          >
            {tab.label}
            {tab.value === 'org' && themesData.data && (
              <span className="rounded-full bg-subtle px-2 py-0.5 text-xs text-muted">{themes.length}</span>
            )}
          </button>
        ))}
      </div>

      {tab === 'general' ? (
        <GeneralLibrary />
      ) : themesData.error ? (
        <Card>
          <EmptyState tone="danger" icon="server" title={t.loadFailed} description={themesData.error} />
        </Card>
      ) : themesData.loading && !themesData.data ? (
        <Card>
          <EmptyState icon="refresh" title={t.loading} />
        </Card>
      ) : themes.length === 0 ? (
        <Card>
          <EmptyState
            icon="file"
            title={t.empty}
            description={t.emptyDesc}
            action={
              <Button to="/admin/tema" icon="plus">
                {t.create}
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
                <Badge tone="outline">{t.category[th.category] || th.category}</Badge>
              </div>

              <div className="flex flex-wrap items-center gap-2 mt-4">
                <Badge tone="brand" icon="users">
                  {th.availableToAllVoceros ? t.allVoceros : t.vocerosWithAccess(th.voceroIds.length)}
                </Badge>
                <Badge tone="neutral" icon="activity">{t.sessionCount(th.sessions)}</Badge>
              </div>

              <div className="flex flex-wrap items-center gap-1 mt-5 pt-4 border-t border-line">
                <Button variant="ghost" size="sm" icon="users" onClick={() => setManaging(th)}>
                  {t.manageVoceros}
                </Button>
                <Button variant="ghost" size="sm" icon="sliders" to={`/admin/tema?id=${th.id}`}>
                  {t.edit}
                </Button>
                <Button variant="ghost" size="sm" icon="trash" className="text-danger hover:bg-danger/10" onClick={() => setDeleting(th)}>
                  {t.delete}
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

// ------------------------------------------- Biblioteca de escenarios generales

function GeneralLibrary() {
  const { d } = useI18n();
  const t = d.L.a5;
  const navigate = useNavigate();
  const { data, loading, error } = useApiData('/api/library/themes');
  const themes = data?.themes || [];
  const [copying, setCopying] = useState(null);

  // Copia el escenario a la organización y abre el editor para adaptarlo
  const copy = async (theme) => {
    try {
      setCopying(theme.id);
      const { theme: copied } = await apiFetch(`/api/library/themes/${theme.id}/copy`, { method: 'POST' });
      toast.success(t.copySuccess);
      navigate(`/admin/tema?id=${copied.id}`);
    } catch (err) {
      toast.error(err.message);
      setCopying(null);
    }
  };

  if (error) {
    return (
      <Card>
        <EmptyState tone="danger" icon="server" title={t.libraryFailed} description={error} />
      </Card>
    );
  }
  if (loading && !data) {
    return (
      <Card>
        <EmptyState icon="refresh" title={t.libraryLoading} />
      </Card>
    );
  }

  return (
    <>
      <p className="-mt-2 mb-6 text-[13px] text-muted leading-relaxed">{t.generalIntro}</p>
      {themes.length === 0 ? (
        <Card>
          <EmptyState icon="layers" title={t.libraryEmpty} description={t.libraryEmptyDesc} />
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {themes.map((th) => (
            <Card key={th.id} className="flex flex-col">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h3 className="text-[15px] font-semibold text-ink">{th.title}</h3>
                  <p className="text-[13px] text-muted mt-1 line-clamp-2">{th.context}</p>
                </div>
                <Badge tone="outline">{t.category[th.category] || th.category}</Badge>
              </div>
              <div className="flex flex-wrap items-center gap-2 mt-4">
                <Badge tone="brand" icon="users">
                  {t.allVoceros}
                </Badge>
                <Badge tone="neutral">{t.keyMessages(th.keyMessages.length)}</Badge>
              </div>
              <div className="flex items-center mt-5 pt-4 border-t border-line">
                <Button variant="ghost" size="sm" icon="plus" onClick={() => copy(th)} disabled={Boolean(copying)}>
                  {copying === th.id ? t.copying : t.copy}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

// ------------------------------------------------ Gestionar voceros con acceso

function ManageVocerosModal({ theme, voceros, onClose, onSaved }) {
  const { d } = useI18n();
  const t = d.L.a5;
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
      toast.success(t.accessUpdated);
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
      title={t.manageTitle}
      description={theme.title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t.cancel}
          </Button>
          <Button icon="check" onClick={save} disabled={saving}>
            {saving ? t.saving : t.save}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-xl border border-line bg-surface p-4">
          <Checkbox checked={all} onChange={setAll}>
            <span className="font-medium text-ink">{t.availableAll}</span>
            <span className="block text-xs text-muted mt-0.5">{t.availableAllDesc}</span>
          </Checkbox>
        </div>

        <div className={cx('rounded-xl border border-line divide-y divide-line max-h-72 overflow-y-auto', all && 'opacity-40 pointer-events-none')}>
          {voceros.map((v) => (
            <label key={v.id} className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-subtle/50">
              <input type="checkbox" checked={ids.includes(v.id)} onChange={() => toggle(v.id)} />
              <Avatar initials={initialsOf(v.name)} size="sm" />
              <span className="flex-1 min-w-0">
                <span className="block text-sm text-ink truncate">{v.name}</span>
                <span className="block text-xs text-muted truncate">{displayEmail(v)}</span>
              </span>
              {v.area && <Badge tone="outline">{v.area}</Badge>}
            </label>
          ))}
          {voceros.length === 0 && <p className="px-4 py-3 text-sm text-muted">{t.noActiveVoceros}</p>}
        </div>
        <p className="text-xs text-faint">{t.selectedCount(ids.length)}</p>
      </div>
    </Modal>
  );
}

// -------------------------------------------------------------- Eliminar tema

function DeleteThemeModal({ theme, onClose, onDeleted }) {
  const { d } = useI18n();
  const t = d.L.a5;
  const [saving, setSaving] = useState(false);

  const confirm = async () => {
    try {
      setSaving(true);
      await apiFetch(`/api/themes/${theme.id}`, { method: 'DELETE' });
      toast.success(t.deleted);
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
      title={t.deleteTitle}
      description={theme.title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t.cancel}
          </Button>
          <Button variant="danger" icon="trash" onClick={confirm} disabled={saving}>
            {saving ? t.deleting : t.deleteConfirm}
          </Button>
        </>
      }
    >
      <p className="text-sm text-muted leading-relaxed">{t.deleteBody}</p>
    </Modal>
  );
}
