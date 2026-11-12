import { useState } from 'react';
import toast from 'react-hot-toast';
import { LANGUAGE_OPTIONS, useI18n } from '../../lib/i18n';
import Icon from '../../components/Icon';
import { Badge, Button, Card, Checkbox, EmptyState, Field, Modal, PageHeader } from '../../components/ui';
import useApiData from '../../hooks/useApiData';
import { API_URL, apiFetch, getToken } from '../../lib/api';

// Administración de microlecciones (solo administrador del sistema).
//
// - El catálogo se pide con `?all=1`: incluye inactivas y todos los idiomas.
// - Cada lección tiene su PROPIO idioma y refuerza una o varias áreas de la rúbrica.
// - El video se sube directamente a VoxReady (nunca un enlace externo) y se muestra el progreso
//   real de la carga. Al crear una lección primero se guardan sus datos y después se sube el video:
//   así no quedan archivos huérfanos si el administrador cancela.
const AREAS = ['expression', 'voice', 'coherence', 'empathy'];
const EMPTY = { title: '', description: '', language: 'es', areas: [], active: true };

// Subida del video con progreso real (fetch no expone el progreso de subida).
function uploadVideo(lessonId, file, onProgress, failureMessage) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', `${API_URL}/api/micro-lessons/${encodeURIComponent(lessonId)}/video`);
    request.setRequestHeader('Authorization', `Bearer ${getToken() || ''}`);
    request.setRequestHeader('Content-Type', file.type || 'video/webm');
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    request.onload = () => {
      let data = null;
      try {
        data = JSON.parse(request.responseText);
      } catch {
        data = null;
      }
      if (request.status >= 200 && request.status < 300) resolve(data);
      else reject(new Error(data?.mensaje || failureMessage));
    };
    request.onerror = () => reject(new Error(failureMessage));
    request.send(file);
  });
}

export default function Microlecciones() {
  const { d } = useI18n();
  const t = d.L.sys.microLessons;
  const u8 = d.L.u8;
  const { data, loading, error, reload } = useApiData('/api/micro-lessons?all=1');
  const lessons = data?.lessons || [];

  const [editing, setEditing] = useState(null); // {} = nueva, {...lesson} = edición
  const [removing, setRemoving] = useState(null);
  const [busy, setBusy] = useState(false);

  const areaLabel = (area) => u8.areaLabels[area] || area;

  const remove = async () => {
    try {
      setBusy(true);
      await apiFetch(`/api/micro-lessons/${removing.id}`, { method: 'DELETE' });
      toast.success(t.removed);
      setRemoving(null);
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
          <Button icon="plus" onClick={() => setEditing({ ...EMPTY })}>
            {t.new}
          </Button>
        }
      />

      {loading && !data && (
        <Card>
          <EmptyState icon="refresh" title={t.loading} />
        </Card>
      )}

      {error && (
        <Card>
          <EmptyState
            icon="alert"
            title={t.error}
            description={error}
            action={
              <Button variant="secondary" icon="refresh" onClick={reload}>
                {t.retry}
              </Button>
            }
          />
        </Card>
      )}

      {!loading && !error && !lessons.length && (
        <Card>
          <EmptyState icon="book" title={t.empty} description={t.emptyHint} />
        </Card>
      )}

      {lessons.length > 0 && (
        <div className="space-y-3">
          {lessons.map((lesson) => (
            <Card key={lesson.id} className="flex flex-col sm:flex-row sm:items-center gap-4">
              <div className="h-12 w-20 rounded-lg bg-subtle flex items-center justify-center shrink-0">
                <Icon name={lesson.hasVideo ? 'video' : 'file'} size={18} className="text-faint" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-ink truncate">{lesson.title}</span>
                  <Badge tone="outline">{lesson.language.toUpperCase()}</Badge>
                  <Badge tone={lesson.active ? 'success' : 'neutral'}>{lesson.active ? t.active : t.inactive}</Badge>
                  {!lesson.hasVideo && <Badge tone="warning">{t.noVideo}</Badge>}
                </div>
                <div className="flex flex-wrap items-center gap-2 mt-2">
                  {lesson.areas.map((area) => (
                    <Badge key={area} tone="accent">
                      {areaLabel(area)}
                    </Badge>
                  ))}
                </div>
                <p className="text-[13px] text-muted mt-2 line-clamp-2">{lesson.description}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button variant="secondary" size="sm" icon="edit" onClick={() => setEditing(lesson)}>
                  {t.editAction}
                </Button>
                <Button variant="ghost" size="sm" icon="trash" onClick={() => setRemoving(lesson)}>
                  {t.remove}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {editing && (
        <LessonForm
          lesson={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            reload();
            setEditing(null);
          }}
        />
      )}

      <Modal
        open={Boolean(removing)}
        onClose={() => setRemoving(null)}
        title={t.confirmDelete}
        description={t.confirmDeleteDesc}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRemoving(null)} disabled={busy}>
              {t.cancel}
            </Button>
            <Button variant="danger" icon="trash" onClick={remove} disabled={busy}>
              {t.remove}
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink">{removing?.title}</p>
      </Modal>

    </>
  );
}

// Formulario de creación/edición. El video se sube después de guardar los datos (así nunca queda un
// archivo sin registro) y se muestra el progreso real de la carga.
function LessonForm({ lesson, onClose, onSaved }) {
  const { d } = useI18n();
  const t = d.L.sys.microLessons;
  const u8 = d.L.u8;
  const [id, setId] = useState(lesson.id || null);
  const [form, setForm] = useState({
    title: lesson.title || '',
    description: lesson.description || '',
    language: lesson.language || 'es',
    areas: lesson.areas || [],
    active: lesson.active ?? true,
  });
  const [hasVideo, setHasVideo] = useState(Boolean(lesson.hasVideo));
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState('');
  // Se guardó algo: al cerrar hay que refrescar la lista del catálogo.
  const [saved, setSaved] = useState(false);

  // Cerrar el formulario. Si se guardó, se recarga el catálogo (onSaved) en vez de descartar.
  const close = () => (saved ? onSaved() : onClose());

  const set = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }));
  const toggleArea = (area) =>
    setForm((current) => ({
      ...current,
      areas: current.areas.includes(area) ? current.areas.filter((item) => item !== area) : [...current.areas, area],
    }));

  const save = async () => {
    setError('');
    if (!form.title.trim()) return setError(t.titleRequired);
    if (!form.description.trim()) return setError(t.descriptionRequired);
    if (!form.areas.length) return setError(t.areasRequired);
    try {
      setSaving(true);
      const body = { ...form, title: form.title.trim(), description: form.description.trim() };
      const result = id
        ? await apiFetch(`/api/micro-lessons/${id}`, { method: 'PUT', body })
        : await apiFetch('/api/micro-lessons', { method: 'POST', body });
      if (!id) {
        setId(result.lesson.id);
        setHasVideo(result.lesson.hasVideo);
        toast.success(t.created);
      } else {
        toast.success(t.updated);
      }
      setSaved(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const pickVideo = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setError('');
    setProgress(0);
    try {
      await uploadVideo(id, file, setProgress, t.uploadError);
      setHasVideo(true);
      toast.success(t.uploaded);
    } catch (err) {
      setError(err.message);
    } finally {
      setProgress(null);
    }
  };

  return (
    <Modal
      open
      onClose={close}
      width="max-w-2xl"
      title={id ? t.edit : t.new}
      description={t.sub}
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={saving}>
            {t.cancel}
          </Button>
          <Button icon="check" onClick={save} disabled={saving}>
            {saving ? t.saving : t.save}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <p className="text-sm text-danger">{error}</p>}

        <Field label={t.fieldTitle}>
          <input className="input" value={form.title} onChange={set('title')} />
        </Field>

        <Field label={t.fieldDescription}>
          <textarea className="input min-h-24" value={form.description} onChange={set('description')} />
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label={t.fieldLanguage} hint={t.fieldLanguageHint}>
            <select className="input" value={form.language} onChange={set('language')}>
              {LANGUAGE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t.fieldAreas}>
            <div className="space-y-2 pt-1">
              {AREAS.map((area) => (
                <Checkbox key={area} checked={form.areas.includes(area)} onChange={() => toggleArea(area)}>
                  {u8.areaLabels[area] || area}
                </Checkbox>
              ))}
            </div>
          </Field>
        </div>

        <Checkbox checked={form.active} onChange={(value) => setForm((current) => ({ ...current, active: value }))}>
          {t.fieldActive}
        </Checkbox>

        <div className="rounded-xl border border-line p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium text-ink">{t.video}</div>
              <p className="text-xs text-muted mt-1">{t.videoHint}</p>
            </div>
            <Badge tone={hasVideo ? 'success' : 'neutral'}>{hasVideo ? t.uploaded : t.noVideo}</Badge>
          </div>
          <div className="mt-3 flex items-center gap-3">
            <input
              id="lesson-video"
              type="file"
              accept="video/webm,video/mp4"
              className="hidden"
              disabled={!id || progress !== null}
              onChange={pickVideo}
            />
            <Button
              variant="secondary"
              icon="upload"
              disabled={!id || progress !== null}
              onClick={() => document.getElementById('lesson-video')?.click()}
            >
              {hasVideo ? t.videoReplace : t.videoUpload}
            </Button>
            {progress !== null && <span className="text-xs text-muted tabular-nums">{t.uploading(progress)}</span>}
          </div>
          {!id && <p className="text-xs text-faint mt-2">{t.saveFirst}</p>}
        </div>
      </div>
    </Modal>
  );
}

