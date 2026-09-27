import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { API_URL, apiFetch, getCurrentUser } from '../lib/api';
import I from '../data/dictionary';
import Icon from '../components/Icon';
import { Avatar, Badge, Button, Card, ChoiceChips, EmptyState, Field, PageHeader, Segmented, cx } from '../components/ui';
import { ScenarioBriefModal } from '../components/ScenarioBrief';
import useApiData from '../hooks/useApiData';
import { initialsOf } from '../data/directory';


function EditableList({ items, setItems, placeholder, addLabel, danger }) {
  const [draft, setDraft] = useState('');

  const add = () => {
    if (!draft.trim()) return;
    setItems([...items, draft.trim()]);
    setDraft('');
  };

  return (
    <div>
      <ul className="space-y-2 mb-3">
        {items.map((item, i) => (
          <li
            key={`${item}-${i}`}
            className={cx(
              'group flex items-center gap-3 rounded-xl border px-4 py-3 text-sm',
              danger ? 'border-danger/20 bg-danger/[0.03]' : 'border-line bg-surface',
            )}
          >
            <Icon name={danger ? 'x' : 'check'} size={14} strokeWidth={2.5} className={danger ? 'text-danger' : 'text-success'} />
            <span className="flex-1 text-ink">{item}</span>
            <button
              onClick={() => setItems(items.filter((_, j) => j !== i))}
              className="opacity-0 group-hover:opacity-100 text-faint hover:text-danger transition-all"
              aria-label="Eliminar"
            >
              <Icon name="trash" size={15} />
            </button>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <input
          className="input"
          value={draft}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
        <Button variant="secondary" icon="plus" onClick={add} className="shrink-0">
          {addLabel}
        </Button>
      </div>
    </div>
  );
}

// Título de cada paso del formulario
function StepTitle({ n, title, description, danger }) {
  return (
    <div className="flex gap-3 mb-5">
      <span className="h-7 w-7 rounded-full bg-primary text-primary-ink text-xs font-semibold flex items-center justify-center shrink-0">{n}</span>
      <div>
        <h3 className="text-[15px] font-semibold text-ink flex items-center gap-2">
          {title}
          {danger && <span className="h-1.5 w-1.5 rounded-full bg-danger" />}
        </h3>
        {description && <p className="text-[13px] text-muted mt-0.5">{description}</p>}
      </div>
    </div>
  );
}

const CATEGORIES = [
  { value: 'CRISIS', label: 'Crisis' },
  { value: 'MEDIOS', label: 'Medios' },
  { value: 'INSTITUCIONAL', label: 'Institucional' },
];

export default function EditorTema() {
  const t = I.es.L.a2;
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const editingId = params.get('id');

  const [name, setName] = useState('');
  const [context, setContext] = useState('');
  const [category, setCategory] = useState('CRISIS');
  const [optic, setOptic] = useState(t.optics[0]);
  const [publics, setPublics] = useState([t.pubs[0]]);
  const [messages, setMessages] = useState([]);
  const [redLines, setRedLines] = useState([]);

  const [availableToAllVoceros, setAvailableToAllVoceros] = useState(false);
  const [voceroIds, setVoceroIds] = useState([]);
  const [saving, setSaving] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [loadingTheme, setLoadingTheme] = useState(Boolean(editingId));

  // Voceros de la organización (para asignar el escenario a personas específicas)
  const { data: usersData } = useApiData('/api/users');
  const voceros = (usersData?.users || []).filter((u) => u.status === 'ACTIVE');

  // Modo edición: cargar el tema existente
  useEffect(() => {
    if (!editingId) return;
    apiFetch(`/api/themes/${editingId}`)
      .then(({ theme }) => {
        setName(theme.title);
        setContext(theme.context);
        setCategory(theme.category || 'CRISIS');
        if (theme.optic) setOptic(theme.optic);
        setPublics(theme.publics.length ? theme.publics : [t.pubs[0]]);
        setMessages(theme.keyMessages);
        setRedLines(theme.redLines);
        setAvailableToAllVoceros(theme.availableToAllVoceros);
        setVoceroIds(theme.voceroIds);
      })
      .catch((err) => toast.error(err.message))
      .finally(() => setLoadingTheme(false));
  }, [editingId, t.pubs]);

  const toggleVocero = (id) => setVoceroIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  const handleSave = async () => {
    try {
      if (!name.trim()) return toast.error('Debes ingresar un nombre para el escenario.');
      if (!context.trim()) return toast.error('Debes ingresar un contexto.');
      if (messages.length === 0) return toast.error('Debes agregar al menos un mensaje clave.');
      if (!availableToAllVoceros && voceroIds.length === 0) {
        return toast.error('Elige "Disponible para todos los voceros" o selecciona al menos un vocero.');
      }

      setSaving(true);
      const payload = {
        title: name,
        context,
        keyMessages: messages,
        category,
        optic,
        publics,
        redLines,
        availableToAllVoceros,
        voceroIds: availableToAllVoceros ? [] : voceroIds,
      };

      if (editingId) {
        await apiFetch(`/api/themes/${editingId}`, { method: 'PUT', body: payload });
        toast.success('Escenario actualizado');
      } else {
        // Endpoint de creación de tu compañero (POST /api/themes)
        const response = await fetch(`${API_URL}/api/themes`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: getCurrentUser()?.email, ...payload }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || data.mensaje || 'No se pudo crear el escenario.');
        toast.success('¡Escenario creado con éxito!');
      }
      navigate('/admin');
    } catch (error) {
      console.error('Error guardando escenario:', error);
      toast.error(error.message || 'No se pudo guardar el escenario.');
    } finally {
      setSaving(false);
    }
  };

  if (loadingTheme) {
    return (
      <Card>
        <EmptyState icon="refresh" title="Cargando escenario…" />
      </Card>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow={t.eyebrow}
        title={editingId ? 'Editar escenario' : 'Nuevo escenario'}
        description={t.sub}
        actions={
          <>
            <Button variant="secondary" icon="eye" onClick={() => setPreviewOpen(true)}>
              Vista previa
            </Button>
            <Button onClick={handleSave} icon="check" disabled={saving}>
              {saving ? 'Guardando…' : editingId ? 'Guardar cambios' : t.save}
            </Button>
          </>
        }
      />

      <div className="space-y-6">
        {/* Fila 1: datos del escenario + quiénes lo practican */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card className="space-y-6">
            <StepTitle n={1} title="Datos del escenario" />
            <Field label={t.nameL}>
              <input className="input" value={name} placeholder="Ej. Retiro de producto defectuoso" onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Tipo de escenario">
              <Segmented options={CATEGORIES} value={category} onChange={setCategory} />
            </Field>
            <Field label={t.ctxL} hint="Lo leerá el vocero antes de practicar y lo usará la IA para entrevistarlo.">
              <textarea className="textarea min-h-[150px]" placeholder={t.ctxPh} value={context} onChange={(e) => setContext(e.target.value)} />
            </Field>
          </Card>

          <Card className="flex flex-col">
            <StepTitle n={2} title="¿Quiénes pueden practicarlo?" description="Hazlo visible para toda la organización o asígnalo a voceros específicos." />

            <div className="rounded-xl border border-line bg-surface p-4">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={availableToAllVoceros}
                  onChange={(e) => setAvailableToAllVoceros(e.target.checked)}
                  className="mt-1"
                />
                <div>
                  <p className="text-sm font-medium text-ink">Disponible para todos los voceros</p>
                  <p className="text-xs text-muted mt-1">Todos los voceros de esta organización podrán ver y utilizar este escenario.</p>
                </div>
              </label>
            </div>

            <div className={cx('mt-4 flex-1 flex flex-col transition-opacity', availableToAllVoceros && 'opacity-40 pointer-events-none')}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-ink">O asígnalo a voceros específicos</span>
                {voceros.length > 0 && (
                  <button
                    type="button"
                    className="text-xs font-medium text-muted hover:text-ink"
                    onClick={() => setVoceroIds(voceroIds.length === voceros.length ? [] : voceros.map((v) => v.id))}
                  >
                    {voceroIds.length === voceros.length ? 'Quitar todos' : 'Seleccionar todos'}
                  </button>
                )}
              </div>
              <div className="rounded-xl border border-line divide-y divide-line flex-1 min-h-[140px] max-h-72 overflow-y-auto">
                {voceros.map((v) => (
                  <label key={v.id} className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-subtle/50">
                    <input type="checkbox" checked={voceroIds.includes(v.id)} onChange={() => toggleVocero(v.id)} />
                    <Avatar initials={initialsOf(v.name)} size="sm" />
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm text-ink truncate">{v.name}</span>
                      <span className="block text-xs text-muted truncate">{v.email}</span>
                    </span>
                    {v.area && <Badge tone="outline">{v.area}</Badge>}
                  </label>
                ))}
                {voceros.length === 0 && (
                  <p className="px-4 py-3 text-sm text-muted">
                    Aún no hay voceros activos. Créalos en <Link to="/admin/voceros" className="underline">Voceros</Link>.
                  </p>
                )}
              </div>
              {!availableToAllVoceros && <p className="text-xs text-faint mt-2">{voceroIds.length} vocero(s) seleccionado(s)</p>}
            </div>
          </Card>
        </div>

        {/* Fila 2: mensajes clave + líneas rojas */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <StepTitle n={3} title={t.keyL} description={t.keyHelp} />
            <EditableList items={messages} setItems={setMessages} placeholder="Escribe un mensaje clave…" addLabel="Añadir" />
          </Card>

          <Card>
            <StepTitle n={4} title={t.redL} description={t.redHelp} danger />
            <EditableList items={redLines} setItems={setRedLines} placeholder="Escribe una línea roja…" addLabel="Añadir" danger />
          </Card>
        </div>

        {/* Fila 3: enfoque */}
        <Card>
          <StepTitle n={5} title="Enfoque de la entrevista" description="Cómo debe comunicar el vocero y a qué público interno está dirigido." />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Field label={t.opticL}>
              <ChoiceChips options={t.optics} value={optic} onChange={setOptic} />
            </Field>
            <Field label={t.pubL} hint="Puedes seleccionar más de uno.">
              <ChoiceChips options={t.pubs} value={publics} onChange={setPublics} multiple />
            </Field>
          </div>
        </Card>
      </div>

      <ScenarioBriefModal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        scenario={{ title: name || 'Escenario sin nombre', context: context || 'Sin contexto aún.', category, optic, keyMessages: messages, redLines }}
      />
    </>
  );
}
