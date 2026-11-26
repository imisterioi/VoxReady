import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { LANGUAGE_OPTIONS, useI18n } from '../../lib/i18n';
import Icon from '../../components/Icon';
import { Badge, Button, Card, Checkbox, EmptyState, Field, Modal, PageHeader, cx } from '../../components/ui';
import useApiData from '../../hooks/useApiData';
import { useVideoFrame, useYoutubePoster } from '../../hooks/useLessonMedia';
import { API_URL, apiFetch, getToken } from '../../lib/api';
import { lessonVideoUrl, parseLessonVideoUrl } from '../../lib/practice/lessonVideo';

// Administración de microlecciones (solo administrador del sistema).
//
// - El catálogo se pide con `?all=1`: incluye inactivas y todos los idiomas.
// - Cada lección tiene su PROPIO idioma y refuerza una o varias áreas de la rúbrica (o GENERAL,
//   que es transversal).
// - Una microlección tiene UNA SOLA fuente de video: un ARCHIVO subido, un ENLACE EXTERNO (p. ej.
//   YouTube) o ninguna. Los controles se bloquean mutuamente y explican qué hacer; una fuente nunca
//   reemplaza a otra en silencio (el backend también lo rechaza con 409).
// - La previsualización muestra la portada real del video (YouTube) o el primer fotograma del archivo.
// - El archivo elegido se sube AL GUARDAR (con progreso real): así no quedan archivos huérfanos, la
//   exclusividad se aplica en orden (quitar una fuente → añadir la otra) y no hay que guardar antes
//   para poder elegir el video.
const AREAS = ['expression', 'voice', 'coherence', 'empathy', 'listening', 'pressure', 'GENERAL'];
const EMPTY = { title: '', description: '', language: 'es', areas: [], active: true, videoUrl: '' };

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

// Previsualización 16:9 del vídeo de la microlección. NUNCA reproduce: muestra la portada de YouTube
// (derivada del identificador validado) o el primer fotograma del archivo, o un estado alternativo.
// La lógica de obtención vive en los hooks compartidos `useLessonMedia` (misma que el catálogo).
function LessonPreview({ t, externalLink, uploadSource }) {
  const poster = useYoutubePoster(externalLink);
  const frame = useVideoFrame(uploadSource);
  const box = 'relative w-full aspect-video overflow-hidden rounded-xl ring-1 ring-line bg-[#0B1118]';

  const neutral = (message) => (
    <div className={cx(box, 'flex flex-col items-center justify-center gap-2 px-4 text-center')}>
      <Icon name="video" size={22} className="text-faint" />
      <p className="text-xs text-muted">{message}</p>
    </div>
  );

  if (externalLink) {
    if (poster.url) {
      return (
        <div className={box}>
          <img src={poster.url} alt="" className="absolute inset-0 h-full w-full object-cover" onError={poster.onError} />
        </div>
      );
    }
    return neutral(t.videoPreviewNoPoster);
  }

  if (uploadSource && frame.status === 'loading') return neutral(t.videoPreviewLoading);
  if (uploadSource && frame.status === 'ok') {
    return (
      <div className={box}>
        <img src={frame.frame} alt="" className="absolute inset-0 h-full w-full object-cover" />
      </div>
    );
  }
  if (uploadSource && frame.status === 'none') return neutral(t.videoPreviewNoPoster);
  return neutral(t.videoPreviewEmpty);
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
                  {lesson.videoSource === 'external' && <Badge tone="accent">{t.videoExternal}</Badge>}
                  {lesson.videoSource === 'upload' && <Badge tone="outline">{t.videoUploaded}</Badge>}
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
    videoUrl: lesson.videoUrl || '',
  });
  // Video YA GUARDADO en el servidor (su retirada es un cambio pendiente hasta guardar).
  const [serverUpload, setServerUpload] = useState(lesson.videoSource === 'upload');
  const [removeUpload, setRemoveUpload] = useState(false);
  // Archivo elegido en el formulario: solo sirve para la previsualización; se sube al guardar.
  const [pendingFile, setPendingFile] = useState(null);
  const [pendingUrl, setPendingUrl] = useState(null);
  const pendingUrlRef = useRef(null);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState('');
  // Se guardó algo: al cerrar hay que refrescar la lista del catálogo.
  const [saved, setSaved] = useState(false);

  const linkText = form.videoUrl.trim();
  const externalLink = parseLessonVideoUrl(linkText);
  const hasLink = linkText.length > 0;
  const savedUpload = serverUpload && !removeUpload;
  const hasUpload = pendingFile !== null || savedUpload;
  // Exclusividad: cada control se bloquea mientras la OTRA fuente esté presente.
  const linkLocked = pendingFile !== null || savedUpload;
  const fileLocked = hasLink;
  // Fuente del archivo para la previsualización: el recién elegido o el guardado (ruta protegida).
  const uploadSource = pendingUrl || (savedUpload && id ? lessonVideoUrl(id, { apiUrl: API_URL, token: getToken() }) : null);

  // Libera el ObjectURL del archivo elegido (al cambiarlo, al quitarlo o al desmontar el formulario).
  const discardPending = () => {
    if (pendingUrlRef.current) URL.revokeObjectURL(pendingUrlRef.current);
    pendingUrlRef.current = null;
    setPendingUrl(null);
    setPendingFile(null);
  };

  useEffect(() => discardPending, []);

  // Cerrar el formulario. Si se guardó, se recarga el catálogo (onSaved) en vez de descartar.
  const close = () => (saved ? onSaved() : onClose());

  const set = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }));
  const clearLink = () => setForm((current) => ({ ...current, videoUrl: '' }));
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
    // El enlace externo se valida también en el cliente (además de en el servidor).
    if (linkText && !externalLink) return setError(t.videoUrlInvalid);
    // Red de seguridad: los controles ya lo impiden, pero NUNCA se guardan dos fuentes a la vez.
    if (hasLink && hasUpload) return setError(t.videoSourceConflict);
    try {
      setSaving(true);
      // 1) Si se quitó el video guardado, se borra ANTES de fijar un enlace (exclusividad del backend).
      if (id && removeUpload && serverUpload) {
        await apiFetch(`/api/micro-lessons/${id}/video`, { method: 'DELETE' });
        setServerUpload(false);
      }
      // 2) Datos + enlace (vacío = sin enlace).
      const body = {
        title: form.title.trim(),
        description: form.description.trim(),
        language: form.language,
        areas: form.areas,
        active: form.active,
        videoUrl: linkText,
      };
      let targetId = id;
      if (id) {
        await apiFetch(`/api/micro-lessons/${id}`, { method: 'PUT', body });
        toast.success(t.updated);
      } else {
        const result = await apiFetch('/api/micro-lessons', { method: 'POST', body });
        targetId = result.lesson.id;
        setId(targetId);
        toast.success(t.created);
      }
      // 3) El archivo elegido se sube al final (cuando ya no hay enlace ni archivo previos).
      if (pendingFile) {
        setProgress(0);
        try {
          await uploadVideo(targetId, pendingFile, setProgress, t.uploadError);
          setServerUpload(true);
          discardPending();
          toast.success(t.uploaded);
        } catch (uploadError) {
          setError(uploadError.message);
        } finally {
          setProgress(null);
        }
      }
      setRemoveUpload(false);
      setSaved(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  // Elegir un archivo: solo prepara la previsualización (la subida ocurre al guardar).
  const pickVideo = (event) => {
    const file = event.target.files?.[0] || null;
    event.target.value = '';
    if (!file) return;
    setError('');
    discardPending();
    try {
      const objectUrl = URL.createObjectURL(file);
      pendingUrlRef.current = objectUrl;
      setPendingUrl(objectUrl);
    } catch {
      pendingUrlRef.current = null;
    }
    setPendingFile(file);
    setRemoveUpload(false);
  };

  // Quitar el video (el recién elegido se descarta; el guardado se borra al guardar).
  const dropVideo = () => {
    discardPending();
    setRemoveUpload(true);
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
            <Badge tone={hasLink || hasUpload ? 'success' : 'neutral'}>
              {hasLink ? t.videoExternal : hasUpload ? t.videoUploaded : t.noVideo}
            </Badge>
          </div>

          <div className="mt-4">
            <div className="eyebrow mb-2">{t.videoPreview}</div>
            <LessonPreview t={t} externalLink={externalLink} uploadSource={uploadSource} />
            <p className="text-xs text-faint mt-2">
              {hasLink ? t.videoPreviewExternal : hasUpload ? t.videoPreviewFrame : t.videoPreviewEmpty}
            </p>
          </div>

          <div className="mt-4">
            <Field label={t.fieldVideoUrl} hint={t.fieldVideoUrlHint}>
              <div className="flex items-start gap-2">
                <input
                  className="input"
                  type="url"
                  inputMode="url"
                  placeholder="https://www.youtube.com/watch?v=…"
                  value={form.videoUrl}
                  onChange={set('videoUrl')}
                  disabled={linkLocked}
                />
                {hasLink && (
                  <Button variant="ghost" size="sm" className="shrink-0" onClick={clearLink}>
                    {t.removeLink}
                  </Button>
                )}
              </div>
            </Field>
            {linkLocked && <p className="text-xs text-faint mt-1">{t.linkLockedHint}</p>}
            {!linkLocked && hasLink && !externalLink && <p className="text-xs text-danger mt-1">{t.videoUrlInvalid}</p>}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <input
              id="lesson-video"
              type="file"
              accept="video/webm,video/mp4"
              className="hidden"
              disabled={fileLocked || saving || progress !== null}
              onChange={pickVideo}
            />
            <Button
              variant="secondary"
              icon="upload"
              disabled={fileLocked || saving || progress !== null}
              onClick={() => document.getElementById('lesson-video')?.click()}
            >
              {hasUpload ? t.videoReplace : t.videoUpload}
            </Button>
            {hasUpload && (
              <Button
                variant="ghost"
                size="sm"
                icon="trash"
                className="text-danger hover:bg-danger/10"
                disabled={saving || progress !== null}
                onClick={dropVideo}
              >
                {t.removeVideo}
              </Button>
            )}
            {progress !== null && <span className="text-xs text-muted tabular-nums">{t.uploading(progress)}</span>}
          </div>
          {fileLocked && <p className="text-xs text-faint mt-2">{t.fileLockedHint}</p>}
          {pendingFile && <p className="text-xs text-faint mt-2">{t.saveFirst}</p>}
        </div>
      </div>
    </Modal>
  );
}

