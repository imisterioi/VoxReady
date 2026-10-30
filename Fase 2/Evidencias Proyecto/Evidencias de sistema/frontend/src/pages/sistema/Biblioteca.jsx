import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import Icon from '../../components/Icon';
import { Badge, Button, Card, EmptyState, Field, Modal, PageHeader, Segmented } from '../../components/ui';
import useApiData from '../../hooks/useApiData';
import { apiFetch } from '../../lib/api';
import { LANGUAGE_OPTIONS, useI18n } from '../../lib/i18n';
import { DEFAULT_INTERVIEW, InterviewConfigFields, InterviewSummary, toInterviewForm, toInterviewPayload, totalTurns } from '../../components/InterviewConfig';

// Biblioteca de escenarios generales (GET/POST/PUT/DELETE /api/library/themes).
// Los crea el equipo de VoxReady, no pertenecen a ninguna organización y todos los
// voceros los ven en la pestaña "Generales". No deben incluir datos de clientes ni de personas.
//
// Las etiquetas visibles (categorías, ópticas, textos del formulario) salen del diccionario del
// idioma activo; el contenido del escenario (título, contexto, mensajes) nunca se traduce.
const CATEGORY_VALUES = ['CRISIS', 'MEDIOS', 'INSTITUCIONAL'];
const EMPTY = { title: '', category: 'CRISIS', context: '', keyMessages: '', redLines: '', interview: DEFAULT_INTERVIEW };

const toLines = (text) => text.split('\n').map((l) => l.trim()).filter(Boolean);

function ScenarioModal({ open, scenario, onClose, onSaved }) {
  const { d, lang } = useI18n();
  const t = d.L.sys.biblioteca;
  const categories = CATEGORY_VALUES.map((value) => ({ value, label: t.categories[value] }));
  const empty = { ...EMPTY, optic: t.optics[0] };
  const [form, setForm] = useState(empty);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [loadedFor, setLoadedFor] = useState(null);

  // Carga los datos al abrir (nuevo o edición). El idioma del escenario se conserva al editar:
  // nunca se cambia solo, y en un escenario nuevo parte del idioma activo del administrador.
  const key = open ? scenario?.id || 'nuevo' : null;
  if (key !== loadedFor) {
    setLoadedFor(key);
    setError('');
    setForm(
      scenario
        ? {
            title: scenario.title,
            category: scenario.category,
            optic: scenario.optic || t.optics[0],
            language: scenario.language || lang,
            context: scenario.context,
            keyMessages: scenario.keyMessages.join('\n'),
            redLines: scenario.redLines.join('\n'),
            interview: toInterviewForm(scenario.interview),
          }
        : { ...empty, language: lang },
    );
  }

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const save = async () => {
    setError('');
    const body = { ...form, keyMessages: toLines(form.keyMessages), redLines: toLines(form.redLines), interview: toInterviewPayload(form.interview) };
    if (!body.title.trim() || !body.context.trim()) return setError(t.errRequired);
    if (!body.keyMessages.length) return setError(t.errKeyMessages);
    if (!(body.interview.questionCount >= 1)) return setError(t.errQuestion);
    if (totalTurns(body.interview) > 30) return setError(t.errTurns);
    try {
      setSaving(true);
      if (scenario) await apiFetch(`/api/library/themes/${scenario.id}`, { method: 'PUT', body });
      else await apiFetch('/api/library/themes', { method: 'POST', body });
      toast.success(scenario ? t.updated : t.created);
      onSaved();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      width="max-w-2xl"
      title={scenario ? t.editTitle : t.newTitle}
      description={t.publishedNotice}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            {t.cancel}
          </Button>
          <Button icon="check" onClick={save} disabled={saving}>
            {saving ? t.saving : t.save}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t.nameL}>
          <input className="input" value={form.title} onChange={set('title')} placeholder={t.namePh} />
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label={t.typeL}>
            <select className="input" value={form.category} onChange={set('category')}>
              {categories.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t.opticL}>
            <select className="input" value={form.optic} onChange={set('optic')}>
              {t.optics.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          </Field>
          <Field label={t.langL} hint={t.langHint}>
            <select className="input" value={form.language} onChange={set('language')}>
              {LANGUAGE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label={t.contextL} hint={t.contextHint}>
          <textarea className="textarea min-h-[96px]" value={form.context} onChange={set('context')} />
        </Field>
        <Field label={t.keyL} hint={t.keyHint}>
          <textarea className="textarea min-h-[96px]" value={form.keyMessages} onChange={set('keyMessages')} />
        </Field>
        <Field label={t.redL} hint={t.redHint}>
          <textarea className="textarea min-h-[72px]" value={form.redLines} onChange={set('redLines')} />
        </Field>
        <div className="pt-4 border-t border-line">
          <h3 className="text-sm font-semibold text-ink mb-4">{t.interviewL}</h3>
          <InterviewConfigFields value={form.interview} onChange={(interview) => setForm((f) => ({ ...f, interview }))} />
        </div>
        {error && (
          <p className="flex items-center gap-2 text-[13px] text-danger">
            <Icon name="alert" size={14} />
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}

export default function Biblioteca() {
  const { d } = useI18n();
  const t = d.L.sys.biblioteca;
  const categories = CATEGORY_VALUES.map((value) => ({ value, label: t.categories[value] }));
  const filters = [{ value: 'TODOS', label: t.allFilter }, ...categories];
  const { data, loading, error, reload } = useApiData('/api/library/themes');
  const themes = useMemo(() => data?.themes || [], [data]);
  const [filter, setFilter] = useState('TODOS');
  // null = cerrado · {} = nuevo · tema = edición. ?nuevo=1 (acceso desde el inicio) abre uno nuevo
  const [params] = useSearchParams();
  const [editing, setEditing] = useState(() => (params.get('nuevo') ? {} : null));
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState(false);

  const visible = themes.filter((th) => filter === 'TODOS' || th.category === filter);

  const remove = async () => {
    try {
      setBusy(true);
      await apiFetch(`/api/library/themes/${deleting.id}`, { method: 'DELETE' });
      toast.success(t.deleted);
      setDeleting(null);
      reload();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow={t.eyebrow}
        title={t.title}
        description={t.sub}
        actions={
          <Button icon="plus" onClick={() => setEditing({})}>
            {t.newScenario}
          </Button>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <Segmented options={filters} value={filter} onChange={setFilter} />
        {!loading && <span className="text-[13px] text-muted">{t.countInLibrary(themes.length)}</span>}
      </div>

      {error ? (
        <Card>
          <EmptyState tone="danger" icon="server" title={t.loadFailed} description={error} />
        </Card>
      ) : loading && !data ? (
        <Card>
          <EmptyState icon="refresh" title={t.loading} />
        </Card>
      ) : visible.length === 0 ? (
        <Card>
          <EmptyState
            icon="layers"
            title={themes.length ? t.emptyFiltered : t.emptyLibrary}
            description={t.emptyDesc}
            action={
              <Button icon="plus" onClick={() => setEditing({})}>
                {t.newScenario}
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {visible.map((th) => {
            const catLabel = t.categories[th.category] || th.category;
            return (
              <Card key={th.id} className="flex flex-col">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-[15px] font-semibold text-ink tracking-tight">{th.title}</h3>
                  <div className="flex shrink-0 gap-1.5">
                    <Badge tone="brand">VoxReady</Badge>
                    <Badge tone="outline">{catLabel}</Badge>
                  </div>
                </div>
                <p className="text-[13px] text-muted mt-2 leading-relaxed line-clamp-3 flex-1">{th.context}</p>
                <InterviewSummary interview={th.interview} className="mt-4 flex flex-wrap items-center gap-2" />
                <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                  <span>{t.keyMessagesCount(th.keyMessages.length)}</span>
                  <span>{t.redLinesCount(th.redLines.length)}</span>
                  <span>{t.sessionsCount(th.sessions)}</span>
                  {th.optic && <span>{t.opticLabel(th.optic)}</span>}
                </div>
                <div className="mt-4 pt-4 border-t border-line flex justify-end gap-2">
                  <Button variant="ghost" size="sm" icon="trash" className="text-danger hover:bg-danger/10" onClick={() => setDeleting(th)}>
                    {t.delete}
                  </Button>
                  <Button variant="secondary" size="sm" icon="file" onClick={() => setEditing(th)}>
                    {t.edit}
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <ScenarioModal open={Boolean(editing)} scenario={editing?.id ? editing : null} onClose={() => setEditing(null)} onSaved={reload} />

      <Modal
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title={t.deleteTitle}
        description={deleting ? t.deleteDesc(deleting.title) : ''}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleting(null)} disabled={busy}>
              {t.cancel}
            </Button>
            <Button variant="danger" icon="trash" onClick={remove} disabled={busy}>
              {t.delete}
            </Button>
          </>
        }
      />
    </>
  );
}
