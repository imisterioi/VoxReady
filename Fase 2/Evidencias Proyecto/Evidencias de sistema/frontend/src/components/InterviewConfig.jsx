import { useI18n } from '../lib/i18n';
import Icon from './Icon';
import { Badge, Button, Field, Segmented } from './ui';
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
  // Duración máxima de la entrevista en minutos. Es obligatoria: la entrevista nunca queda sin
  // límite de tiempo, así que un escenario antiguo sin duración guardada también usa 5.
  estimatedMinutes: DEFAULT_MINUTES,
  interviewerRole: '',
  spokespersonRole: '',
  maxAnswerSeconds: '', // vacío = sin límite
  customQuestions: [], // preguntas propias del escenario (se hacen primero, en orden)
};

export const MAX_CUSTOM_QUESTIONS = 12;
const MAX_CUSTOM_CHARS = 300;

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
    // Duración máxima efectiva: el backend siempre la informa (5 min por defecto cuando el
    // escenario no tenía duración guardada). El formulario nunca queda vacío.
    estimatedMinutes: interview.estimatedMinutes ?? DEFAULT_MINUTES,
    interviewerRole: interview.interviewerRole || '',
    spokespersonRole: interview.spokespersonRole || '',
    maxAnswerSeconds: interview.maxAnswerSeconds ?? '',
    customQuestions: Array.isArray(interview.customQuestions) ? interview.customQuestions : [],
  };
}

// Valores del formulario → lo que espera la API (vacío = null)
export function toInterviewPayload(form) {
  const numberOrNull = (v) => (v === '' || v == null ? null : Number(v));
  return {
    aggressiveness: form.aggressiveness,
    questionCount: Number(form.questionCount),
    followUps: Number(form.followUps),
    // Duración máxima obligatoria: se envía siempre un número (nunca null ni vacío). El backend la
    // valida (422 si no es válida) y el formulario bloquea el guardado antes de enviarla.
    estimatedMinutes: Number(form.estimatedMinutes),
    interviewerRole: form.interviewerRole.trim(),
    spokespersonRole: (form.spokespersonRole || '').trim(),
    maxAnswerSeconds: numberOrNull(form.maxAnswerSeconds),
    customQuestions: (form.customQuestions || []).map((q) => String(q).trim()).filter(Boolean),
  };
}

// Editor de preguntas personalizadas: el entrevistador IA las hace primero, en el orden indicado.
function CustomQuestions({ value = [], onChange, t }) {
  const list = value.length ? value : [];
  const update = (i, text) => onChange(list.map((q, j) => (j === i ? text : q)));
  const remove = (i) => onChange(list.filter((_, j) => j !== i));
  const move = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    const next = [...list];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  return (
    <Field label={t.customQuestionsL} hint={t.customQuestionsHint}>
      <div className="space-y-2">
        {list.map((q, i) => (
          <div key={i} className="flex items-start gap-2">
            <span className="mt-2.5 w-6 shrink-0 text-right text-xs font-semibold tabular-nums text-muted">{i + 1}.</span>
            <textarea
              className="textarea min-h-[44px] flex-1"
              rows={1}
              maxLength={MAX_CUSTOM_CHARS}
              value={q}
              placeholder={t.customQuestionPh}
              aria-label={t.customQuestionAria(i + 1)}
              onChange={(e) => update(i, e.target.value)}
            />
            <div className="flex flex-col">
              <button type="button" className="px-1 text-xs text-muted hover:text-ink disabled:opacity-30" disabled={i === 0} onClick={() => move(i, -1)} aria-label={t.moveUp}>
                ▲
              </button>
              <button type="button" className="px-1 text-xs text-muted hover:text-ink disabled:opacity-30" disabled={i === list.length - 1} onClick={() => move(i, 1)} aria-label={t.moveDown}>
                ▼
              </button>
            </div>
            <button type="button" className="mt-2 text-muted hover:text-danger" onClick={() => remove(i)} aria-label={t.removeQuestion}>
              <Icon name="trash" size={16} />
            </button>
          </div>
        ))}
        {list.length < MAX_CUSTOM_QUESTIONS && (
          <Button type="button" variant="secondary" size="sm" icon="plus" onClick={() => onChange([...list, ''])}>
            {t.addQuestion}
          </Button>
        )}
      </div>
    </Field>
  );
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

      <CustomQuestions
        value={value.customQuestions || []}
        // Cada pregunta personalizada es una pregunta principal: el total se ajusta para que quepan.
        onChange={(questions) =>
          onChange({
            ...value,
            customQuestions: questions,
            questionCount: Math.max(Number(value.questionCount) || 1, questions.filter((q) => q.trim()).length),
          })
        }
        t={t}
      />

      <Field label={t.spokespersonL} hint={t.spokespersonHint}>
        <input
          className="input"
          maxLength={120}
          value={value.spokespersonRole || ''}
          placeholder={t.spokespersonPh}
          onChange={set('spokespersonRole')}
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
  // Duración máxima efectiva (no la estimación de referencia).
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
      {interview.customQuestions?.length > 0 && (
        <Badge tone="brand" icon="edit">
          {t.summaryCustom(interview.customQuestions.length)}
        </Badge>
      )}
    </div>
  );
}
