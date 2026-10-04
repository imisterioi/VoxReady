import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import Icon from '../../components/Icon';
import { Badge, Button, Card, EmptyState, Field, Modal, PageHeader, Segmented } from '../../components/ui';
import useApiData from '../../hooks/useApiData';
import { apiFetch } from '../../lib/api';

// Biblioteca de escenarios generales (GET/POST/PUT/DELETE /api/library/themes).
// Los crea el equipo de VoxReady, no pertenecen a ninguna organización y todos los
// voceros los ven en la pestaña "Generales". No deben incluir datos de clientes ni de personas.
const CATEGORIES = [
  { value: 'CRISIS', label: 'Crisis', tone: 'danger' },
  { value: 'MEDIOS', label: 'Medios', tone: 'accent' },
  { value: 'INSTITUCIONAL', label: 'Institucional', tone: 'neutral' },
];
const OPTICS = ['Empática', 'Formal', 'Técnica'];
const FILTERS = [{ value: 'TODOS', label: 'Todos' }, ...CATEGORIES];
const EMPTY = { title: '', category: 'CRISIS', optic: 'Empática', context: '', keyMessages: '', redLines: '' };

const toLines = (text) => text.split('\n').map((l) => l.trim()).filter(Boolean);

function ScenarioModal({ open, scenario, onClose, onSaved }) {
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [loadedFor, setLoadedFor] = useState(null);

  // Carga los datos al abrir (nuevo o edición)
  const key = open ? scenario?.id || 'nuevo' : null;
  if (key !== loadedFor) {
    setLoadedFor(key);
    setError('');
    setForm(
      scenario
        ? {
            title: scenario.title,
            category: scenario.category,
            optic: scenario.optic || 'Empática',
            context: scenario.context,
            keyMessages: scenario.keyMessages.join('\n'),
            redLines: scenario.redLines.join('\n'),
          }
        : EMPTY,
    );
  }

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const save = async () => {
    setError('');
    const body = { ...form, keyMessages: toLines(form.keyMessages), redLines: toLines(form.redLines) };
    if (!body.title.trim() || !body.context.trim()) return setError('El nombre y el contexto son obligatorios.');
    if (!body.keyMessages.length) return setError('Agrega al menos un mensaje clave.');
    try {
      setSaving(true);
      if (scenario) await apiFetch(`/api/library/themes/${scenario.id}`, { method: 'PUT', body });
      else await apiFetch('/api/library/themes', { method: 'POST', body });
      toast.success(scenario ? 'Escenario actualizado' : 'Escenario general creado');
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
      title={scenario ? 'Editar escenario general' : 'Nuevo escenario general'}
      description="Se publica a nombre de VoxReady y lo verán todos los voceros de todas las organizaciones. No incluyas nombres de clientes, personas ni datos reales."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button icon="check" onClick={save} disabled={saving}>
            {saving ? 'Guardando…' : 'Guardar escenario'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Nombre del escenario">
          <input className="input" value={form.title} onChange={set('title')} placeholder="Ej. Filtración de datos de clientes" />
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Tipo">
            <select className="input" value={form.category} onChange={set('category')}>
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Óptica institucional">
            <select className="input" value={form.optic} onChange={set('optic')}>
              {OPTICS.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Contexto" hint="La situación que enfrenta el vocero. El entrevistador IA la usa para preguntar.">
          <textarea className="textarea min-h-[96px]" value={form.context} onChange={set('context')} />
        </Field>
        <Field label="Mensajes clave" hint="Uno por línea. Lo que el vocero debe sostener.">
          <textarea className="textarea min-h-[96px]" value={form.keyMessages} onChange={set('keyMessages')} />
        </Field>
        <Field label="Líneas rojas" hint="Una por línea. Lo que el vocero nunca debe decir.">
          <textarea className="textarea min-h-[72px]" value={form.redLines} onChange={set('redLines')} />
        </Field>
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
  const { data, loading, error, reload } = useApiData('/api/library/themes');
  const themes = useMemo(() => data?.themes || [], [data]);
  const [filter, setFilter] = useState('TODOS');
  // null = cerrado · {} = nuevo · tema = edición. ?nuevo=1 (acceso desde el inicio) abre uno nuevo
  const [params] = useSearchParams();
  const [editing, setEditing] = useState(() => (params.get('nuevo') ? {} : null));
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState(false);

  const visible = themes.filter((t) => filter === 'TODOS' || t.category === filter);

  const remove = async () => {
    try {
      setBusy(true);
      await apiFetch(`/api/library/themes/${deleting.id}`, { method: 'DELETE' });
      toast.success('Escenario eliminado de la biblioteca');
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
        eyebrow="Biblioteca de VoxReady"
        title="Escenarios generales"
        description="Escenarios publicados a nombre de VoxReady que ven todos los voceros, de todas las organizaciones. Así nadie se queda sin material para practicar."
        actions={
          <Button icon="plus" onClick={() => setEditing({})}>
            Nuevo escenario
          </Button>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <Segmented options={FILTERS} value={filter} onChange={setFilter} />
        {!loading && <span className="text-[13px] text-muted">{themes.length} escenario(s) en la biblioteca</span>}
      </div>

      {error ? (
        <Card>
          <EmptyState tone="danger" icon="server" title="No se pudo cargar la biblioteca" description={error} />
        </Card>
      ) : loading && !data ? (
        <Card>
          <EmptyState icon="refresh" title="Cargando biblioteca…" />
        </Card>
      ) : visible.length === 0 ? (
        <Card>
          <EmptyState
            icon="layers"
            title={themes.length ? 'No hay escenarios de este tipo' : 'La biblioteca está vacía'}
            description="Crea escenarios generales para que los voceros tengan con qué practicar desde el primer día."
            action={
              <Button icon="plus" onClick={() => setEditing({})}>
                Nuevo escenario
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {visible.map((t) => {
            const cat = CATEGORIES.find((c) => c.value === t.category) || { label: t.category, tone: 'neutral' };
            return (
              <Card key={t.id} className="flex flex-col">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-[15px] font-semibold text-ink tracking-tight">{t.title}</h3>
                  <div className="flex shrink-0 gap-1.5">
                    <Badge tone="brand">VoxReady</Badge>
                    <Badge tone={cat.tone}>{cat.label}</Badge>
                  </div>
                </div>
                <p className="text-[13px] text-muted mt-2 leading-relaxed line-clamp-3 flex-1">{t.context}</p>
                <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                  <span>{t.keyMessages.length} mensaje(s) clave</span>
                  <span>{t.redLines.length} línea(s) roja(s)</span>
                  <span>{t.sessions} práctica(s)</span>
                  {t.optic && <span>Óptica {t.optic.toLowerCase()}</span>}
                </div>
                <div className="mt-4 pt-4 border-t border-line flex justify-end gap-2">
                  <Button variant="ghost" size="sm" icon="trash" className="text-danger hover:bg-danger/10" onClick={() => setDeleting(t)}>
                    Eliminar
                  </Button>
                  <Button variant="secondary" size="sm" icon="file" onClick={() => setEditing(t)}>
                    Editar
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
        title="Eliminar escenario general"
        description={deleting ? `"${deleting.title}" dejará de estar disponible para todos los voceros. Las prácticas ya realizadas se conservan.` : ''}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleting(null)} disabled={busy}>
              Cancelar
            </Button>
            <Button variant="danger" icon="trash" onClick={remove} disabled={busy}>
              Eliminar
            </Button>
          </>
        }
      />
    </>
  );
}
