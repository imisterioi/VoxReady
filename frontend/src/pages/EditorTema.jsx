import { useState } from 'react';
import toast from 'react-hot-toast';
import I from '../data/dictionary';
import Icon from '../components/Icon';
import { Button, Card, ChoiceChips, Field, PageHeader, cx } from '../components/ui';

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

export default function EditorTema() {
  const t = I.es.L.a2;

  const [name, setName] = useState(t.nameV);
  const [context, setContext] = useState('');
  const [optic, setOptic] = useState(t.optics[0]);
  const [publics, setPublics] = useState([t.pubs[0]]);
  const [messages, setMessages] = useState([
    'La seguridad de los clientes es nuestra prioridad.',
    'Ya contactamos a todos los clientes afectados.',
  ]);
  const [redLines, setRedLines] = useState(['Culpar a proveedores o terceros.']);

  const handleSave = () => {
    toast.success('¡Tema guardado con éxito!');
  };

  return (
    <>
      <PageHeader
        eyebrow={t.eyebrow}
        title={t.title}
        description={t.sub}
        actions={
          <>
            <Button variant="secondary" icon="eye">
              {t.preview}
            </Button>
            <Button onClick={handleSave} icon="check">
              {t.save}
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.2fr] gap-6">
        <Card className="space-y-6 h-fit">
          <Field label={t.nameL}>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label={t.ctxL}>
            <textarea className="textarea min-h-[120px]" placeholder={t.ctxPh} value={context} onChange={(e) => setContext(e.target.value)} />
          </Field>
          <Field label={t.opticL}>
            <ChoiceChips options={t.optics} value={optic} onChange={setOptic} />
          </Field>
          <Field label={t.pubL} hint="Puedes seleccionar más de uno.">
            <ChoiceChips options={t.pubs} value={publics} onChange={setPublics} multiple />
          </Field>
        </Card>

        <div className="space-y-6">
          <Card>
            <div className="mb-4">
              <h3 className="text-[15px] font-semibold text-ink">{t.keyL}</h3>
              <p className="text-[13px] text-muted mt-1">{t.keyHelp}</p>
            </div>
            <EditableList items={messages} setItems={setMessages} placeholder="Escribe un mensaje clave…" addLabel="Añadir" />
          </Card>

          <Card>
            <div className="mb-4">
              <h3 className="text-[15px] font-semibold text-ink flex items-center gap-2">
                {t.redL}
                <span className="h-1.5 w-1.5 rounded-full bg-danger" />
              </h3>
              <p className="text-[13px] text-muted mt-1">{t.redHelp}</p>
            </div>
            <EditableList items={redLines} setItems={setRedLines} placeholder="Escribe una línea roja…" addLabel="Añadir" danger />
          </Card>
        </div>
      </div>
    </>
  );
}
