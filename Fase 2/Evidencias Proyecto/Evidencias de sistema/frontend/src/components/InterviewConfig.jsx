import { useI18n } from '../lib/i18n';
import { Badge, Field, Segmented } from './ui';
import { DEFAULT_MINUTES, MINUTES_RANGE, interviewConfigIssues, maxTurnsPotential, TURN_LIMIT } from '../lib/practice/interviewLimits';

// Configuración de la entrevista de un escenario (misma estructura que backend/ai/interviewConfig.js):
// nivel de agresividad del entrevistador, preguntas y repreguntas, duración máxima,
// quién entrevista y tiempo máximo por respuesta.
//
// Los niveles solo declaran su valor y su tono visual: la etiqueta y la ayuda visibles vienen del
// diccionario del idioma activo (`d.L.cfg.levels`).

export const AGGRESSIVENESS = [
  { value: 'BAJA', tone: 'success' },
  { value: 'MEDIA', tone: 'neutral' },
  { value: 'ALTA', tone: 'warning' },
  { value: 'EXTREMA', tone: 'danger' },
];

export const DEFAULT_INTERVIEW = {
  aggressiveness: 'MEDIA',
  questionCount: 5,
  followUps: 0,
  // Duración MÁXIMA de la entrevista en minutos. Es obligatoria: la entrevista nunca queda sin
  // límite de tiempo, así que un escenario antiguo sin duración guardada también usa 5.
  estimatedMinutes: DEFAULT_MINUTES,
  interviewerRole: '',
  maxAnswerSeconds: '', // vacío = sin límite
};

const MINUTES_PER_TURN = 1.2;
const MAX_TURNS = 30;

export const totalTurns = (cfg) => Number(cfg.questionCount || 0) * (1 + Number(cfg.followUps || 0));
export const autoMinutes = (cfg) => Math.max(1, Math.round(totalTurns(cfg) * MINUTES_PER_TURN));

// Lo que devuelve la API → valores del formulario
export function toInterviewForm(interview) {
  if (!interview) return DEFAULT_INTERVIEW;
  return {
    aggressiveness: interview.aggressiveness,
    questionCount: interview.questionCount,
    followUps: interview.followUps,
    // Duración MÁXIMA efectiva: el backend siempre la informa (5 min por defecto cuando el
    // escenario no tenía duración guardada). El formulario nunca queda vacío.
    estimatedMinutes: interview.estimatedMinutes ?? DEFAULT_MINUTES,
    interviewerRole: interview.interviewerRole || '',
    maxAnswerSeconds: interview.maxAnswerSeconds ?? '',
  };
}

// Valores del formulario → lo que espera la API (vacío = null)
export function toInterviewPayload(form) {
  const numberOrNull = (v) => (v === '' || v == null ? null : Number(v));
  return {
    aggressiveness: form.aggressiveness,
    questionCount: Number(form.questionCount),
    followUps: Number(form.followUps),
    // Duración máxima OBLIGATORIA: se envía SIEMPRE un número (nunca null ni vacío). El backend la
    // valida (422 si no es válida) y el formulario bloquea el guardado antes de enviarla.
    estimatedMinutes: Number(form.estimatedMinutes),
    interviewerRole: form.interviewerRole.trim(),
    maxAnswerSeconds: numberOrNull(form.maxAnswerSeconds),
  };
}

export function InterviewConfigFields({ value, onChange }) {
  const { d } = useI18n();
  const t = d.L.cfg;
  const set = (field) => (input) => onChange({ ...value, [field]: input?.target ? input.target.value : input });
  const levelValue = AGGRESSIVENESS.find((a) => a.value === value.aggressiveness) || AGGRESSIVENESS[1];
  const level = t.levels[levelValue.value];
  const levelOptions = AGGRESSIVENESS.map((a) => ({ value: a.value, label: t.levels[a.value].label }));
  const maxQuestions = Math.min(12, Math.floor(MAX_TURNS / (1 + Number(value.followUps || 0))));
  const issues = interviewConfigIssues(value);
  const issueText = (issue) => {
    const message = t.issues[`${issue.field}:${issue.code}`];
    return typeof message === 'function' ? message(issue) : message || issue.mensaje;
  };
  const potentialTurns = maxTurnsPotential(value);

  return (
    <div className="space-y-6">
      <Field label={t.aggressivenessL} hint={level.help}>
        <Segmented options={levelOptions} value={value.aggressiveness} onChange={set('aggressiveness')} />
      </Field>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
      {issues.length > 0 && (
        <div className="rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-300 space-y-1">
          <p className="font-medium">{t.invalidTitle}</p>
          <ul className="list-disc pl-5 space-y-0.5">
            {issues.map((issue) => (
              <li key={`${issue.field}-${issue.code}`}>{issueText(issue)}</li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-[12px] text-muted">
        {t.technicalLimit(TURN_LIMIT, potentialTurns)}
      </p>

      <Field label={t.questionsL} hint={t.questionsHint}>
          <input className="input" type="number" min={1} max={maxQuestions} value={value.questionCount} onChange={set('questionCount')} />
        </Field>
        <Field label={t.followUpsL} hint={t.followUpsHint}>
          <select className="input" value={value.followUps} onChange={set('followUps')}>
            <option value={0}>{t.noFollowUps}</option>
            <option value={1}>{t.followUp(1)}</option>
            <option value={2}>{t.followUp(2)}</option>
            <option value={3}>{t.followUp(3)}</option>
          </select>
        </Field>
        <Field
          label={t.minutesL}
          hint={t.minutesHint(MINUTES_RANGE[0], MINUTES_RANGE[1], autoMinutes(value))}
        >
          <input
            className="input"
            type="number"
            min={MINUTES_RANGE[0]}
            max={MINUTES_RANGE[1]}
            required
            value={value.estimatedMinutes}
            onChange={set('estimatedMinutes')}
          />
        </Field>
        <Field label={t.maxAnswerL} hint={t.maxAnswerHint}>
          <input className="input" type="number" min={15} max={600} placeholder={t.maxAnswerPh} value={value.maxAnswerSeconds} onChange={set('maxAnswerSeconds')} />
        </Field>
      </div>

      <Field label={t.interviewerL} hint={t.interviewerHint}>
        <input
          className="input"
          maxLength={120}
          value={value.interviewerRole}
          placeholder={t.interviewerPh}
          onChange={set('interviewerRole')}
        />
      </Field>
    </div>
  );
}

// Resumen compacto para las tarjetas y la vista previa del escenario
export function InterviewSummary({ interview, className }) {
  const { d } = useI18n();
  const t = d.L.cfg;
  if (!interview) return null;
  const levelValue = AGGRESSIVENESS.find((a) => a.value === interview.aggressiveness) || AGGRESSIVENESS[1];
  const level = t.levels[levelValue.value];
  const turns = interview.totalTurns ?? totalTurns(interview);
  // Duración MÁXIMA efectiva (no la estimación de referencia).
  const minutes = interview.estimatedMinutes ?? DEFAULT_MINUTES;
  return (
    <div className={className || 'flex flex-wrap items-center gap-2'}>
      <Badge tone="outline" icon="message">
        {t.summaryQuestions(turns)}
        {Number(interview.followUps) > 0 && t.summaryWithFollowUps}
      </Badge>
      <Badge tone="outline" icon="clock">
        {t.summaryMax(minutes)}{interview.estimatedMinutesAuto ? t.summaryAuto : ''}
      </Badge>
      <Badge tone={levelValue.tone === 'neutral' ? 'outline' : levelValue.tone} icon="zap">
        {t.summaryPressure(level.label.toLowerCase())}
      </Badge>
    </div>
  );
}
