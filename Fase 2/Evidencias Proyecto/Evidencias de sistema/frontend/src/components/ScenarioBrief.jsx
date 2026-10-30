import Icon from './Icon';
import { Badge, Button, Modal } from './ui';
import { useI18n } from '../lib/i18n';
import { InterviewSummary } from './InterviewConfig';

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
  const { d } = useI18n();
  const keyMessages = parseList(scenario.keyMessages);
  const redLines = parseList(scenario.redLines);

  return (
    <div className="space-y-6">
      <div>
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <Badge tone="accent">{d.ui.brief.category[scenario.category] || scenario.category || d.ui.brief.scenario}</Badge>
          {scenario.optic && <Badge tone="outline">{d.ui.brief.optic(scenario.optic.toLowerCase())}</Badge>}
          <InterviewSummary interview={scenario.interview} className="contents" />
        </div>
        {!compact && <h2 className="font-display text-[22px] font-semibold tracking-[-0.02em] text-ink">{scenario.title}</h2>}
        <p className="text-[15px] text-muted leading-relaxed mt-2">{scenario.context}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-xl border border-success/25 bg-success/[0.04] p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-ink mb-3">
            <Icon name="check" size={15} strokeWidth={2.5} className="text-success" />
            {d.ui.brief.keyMessages}
          </div>
          <ul className="space-y-2">
            {keyMessages.map((m) => (
              <li key={m} className="text-[13px] text-ink leading-relaxed flex gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-success mt-2 shrink-0" />
                {m}
              </li>
            ))}
            {!keyMessages.length && <li className="text-[13px] text-muted">{d.ui.brief.noKeyMessages}</li>}
          </ul>
        </div>

        <div className="rounded-xl border border-danger/25 bg-danger/[0.04] p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-ink mb-3">
            <Icon name="alert" size={15} className="text-danger" />
            {d.ui.brief.redLines}
          </div>
          <ul className="space-y-2">
            {redLines.map((m) => (
              <li key={m} className="text-[13px] text-ink leading-relaxed flex gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-danger mt-2 shrink-0" />
                {m}
              </li>
            ))}
            {!redLines.length && <li className="text-[13px] text-muted">{d.ui.brief.noRedLines}</li>}
          </ul>
        </div>
      </div>
    </div>
  );
}

// Ventana emergente con el escenario (se abre al entrar a la preparación)
export function ScenarioBriefModal({ scenario, open, onClose }) {
  const { d } = useI18n();
  if (!scenario) return null;
  return (
    <Modal
      open={open}
      onClose={onClose}
      width="max-w-2xl"
      title={scenario.title}
      description={d.ui.brief.modalDescription}
      footer={
        <Button onClick={onClose} iconRight="arrowRight">
          {d.ui.brief.understood}
        </Button>
      }
    >
      <BriefContent scenario={scenario} compact />
    </Modal>
  );
}
