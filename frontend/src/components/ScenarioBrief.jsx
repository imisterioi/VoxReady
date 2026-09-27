import Icon from './Icon';
import { Badge, Button, Modal } from './ui';

const CATEGORY = { CRISIS: 'Crisis', MEDIOS: 'Medios', INSTITUCIONAL: 'Institucional', GENERAL: 'General' };

// Los temas guardan listas como JSON (editor de temas) o texto plano (seed antiguo)
export function parseList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.filter(Boolean);
  } catch {
    /* texto plano */
  }
  return [String(value)];
}

function BriefContent({ scenario, compact = false }) {
  const keyMessages = parseList(scenario.keyMessages);
  const redLines = parseList(scenario.redLines);

  return (
    <div className="space-y-6">
      <div>
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <Badge tone="accent">{CATEGORY[scenario.category] || scenario.category || 'Escenario'}</Badge>
          {scenario.optic && <Badge tone="outline">Óptica {scenario.optic.toLowerCase()}</Badge>}
        </div>
        {!compact && <h2 className="font-display text-[22px] font-semibold tracking-[-0.02em] text-ink">{scenario.title}</h2>}
        <p className="text-[15px] text-muted leading-relaxed mt-2">{scenario.context}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-xl border border-success/25 bg-success/[0.04] p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-ink mb-3">
            <Icon name="check" size={15} strokeWidth={2.5} className="text-success" />
            Mensajes clave que debes sostener
          </div>
          <ul className="space-y-2">
            {keyMessages.map((m) => (
              <li key={m} className="text-[13px] text-ink leading-relaxed flex gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-success mt-2 shrink-0" />
                {m}
              </li>
            ))}
            {!keyMessages.length && <li className="text-[13px] text-muted">Sin mensajes definidos.</li>}
          </ul>
        </div>

        <div className="rounded-xl border border-danger/25 bg-danger/[0.04] p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-ink mb-3">
            <Icon name="alert" size={15} className="text-danger" />
            Líneas rojas (nunca decir)
          </div>
          <ul className="space-y-2">
            {redLines.map((m) => (
              <li key={m} className="text-[13px] text-ink leading-relaxed flex gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-danger mt-2 shrink-0" />
                {m}
              </li>
            ))}
            {!redLines.length && <li className="text-[13px] text-muted">Sin líneas rojas definidas.</li>}
          </ul>
        </div>
      </div>
    </div>
  );
}

// Ventana emergente con el escenario (se abre al entrar a la preparación)
export function ScenarioBriefModal({ scenario, open, onClose }) {
  if (!scenario) return null;
  return (
    <Modal
      open={open}
      onClose={onClose}
      width="max-w-2xl"
      title={scenario.title}
      description="Lee el escenario antes de preparar tu cámara y micrófono."
      footer={
        <Button onClick={onClose} iconRight="arrowRight">
          Entendido, preparar equipo
        </Button>
      }
    >
      <BriefContent scenario={scenario} compact />
    </Modal>
  );
}
