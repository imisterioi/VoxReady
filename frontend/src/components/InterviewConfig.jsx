import { Badge, Field, Segmented } from './ui';
import { DEFAULT_MINUTES, MINUTES_RANGE, interviewConfigIssues, maxTurnsPotential, TURN_LIMIT } from '../lib/practice/interviewLimits';

// Configuración de la entrevista de un escenario (misma estructura que backend/ai/interviewConfig.js):
// nivel de agresividad del entrevistador, preguntas y repreguntas, duración máxima,
// quién entrevista y tiempo máximo por respuesta.

export const AGGRESSIVENESS = [
  { value: 'BAJA', label: 'Baja', tone: 'success', help: 'Cordial: da espacio para explicarse y no confronta.' },
  { value: 'MEDIA', label: 'Media', tone: 'neutral', help: 'Incisivo pero respetuoso: no acepta respuestas genéricas.' },
  { value: 'ALTA', label: 'Alta', tone: 'warning', help: 'Confrontacional: cuestiona la versión oficial y presiona por responsables y cifras.' },
  { value: 'EXTREMA', label: 'Extrema', tone: 'danger', help: 'Hostil: toma las palabras del vocero en su peor interpretación. Ej.: “¿Dice entonces que…?”' },
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
  const set = (field) => (input) => onChange({ ...value, [field]: input?.target ? input.target.value : input });
  const level = AGGRESSIVENESS.find((a) => a.value === value.aggressiveness) || AGGRESSIVENESS[1];
  const turns = totalTurns(value);
  const maxQuestions = Math.min(12, Math.floor(MAX_TURNS / (1 + Number(value.followUps || 0))));
  const issues = interviewConfigIssues(value);
  const potentialTurns = maxTurnsPotential(value);

  return (
    <div className="space-y-6">
      <Field label="Nivel de agresividad del entrevistador" hint={level.help}>
        <Segmented options={AGGRESSIVENESS} value={value.aggressiveness} onChange={set('aggressiveness')} />
      </Field>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
      {issues.length > 0 && (
        <div className="rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-300 space-y-1">
          <p className="font-medium">Esta configuración no se puede guardar ni iniciar:</p>
          <ul className="list-disc pl-5 space-y-0.5">
            {issues.map((issue) => (
              <li key={`${issue.field}-${issue.code}`}>{issue.mensaje}</li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-[12px] text-muted">
        Máximo técnico: {TURN_LIMIT} turnos potenciales. Esta configuración puede llegar a{' '}
        <span className="tabular-nums font-medium">{potentialTurns}</span> turnos
        (principales + repreguntas habituales + extraordinarias por agresividad + aclaraciones de
        contingencia). El backend valida el mismo cálculo y rechaza lo que exceda el límite.
      </p>

      <Field label="Cantidad de preguntas" hint="Preguntas principales, cada una sobre un aspecto distinto.">
          <input className="input" type="number" min={1} max={maxQuestions} value={value.questionCount} onChange={set('questionCount')} />
        </Field>
        <Field label="Repreguntas por pregunta" hint="Veces que el entrevistador insiste sobre la respuesta del vocero antes de cambiar de tema.">
          <select className="input" value={value.followUps} onChange={set('followUps')}>
            <option value={0}>Sin repreguntas fijas</option>
            <option value={1}>1 repregunta</option>
            <option value={2}>2 repreguntas</option>
            <option value={3}>3 repreguntas</option>
          </select>
        </Field>
        <Field
          label="Duración máxima de la entrevista (minutos)"
          hint={`Obligatoria (${MINUTES_RANGE[0]} a ${MINUTES_RANGE[1]}). Es el límite REAL de toda la entrevista, compartido por todos sus temas: al alcanzarlo se cierra aunque queden preguntas pendientes. Referencia orientativa para estas preguntas: ~${autoMinutes(value)} min.`}
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
        <Field label="Tiempo máximo por respuesta (segundos)" hint="Al cumplirse, el entrevistador pasa a la siguiente pregunta. Vacío = sin límite.">
          <input className="input" type="number" min={15} max={600} placeholder="Sin límite" value={value.maxAnswerSeconds} onChange={set('maxAnswerSeconds')} />
        </Field>
      </div>

      <Field label="¿Quién entrevista?" hint="Opcional. Define el rol del entrevistador IA. Por defecto: un periodista chileno.">
        <input
          className="input"
          maxLength={120}
          value={value.interviewerRole}
          placeholder="Ej. una periodista de TV en un despacho en vivo, un dirigente sindical…"
          onChange={set('interviewerRole')}
        />
      </Field>
    </div>
  );
}

// Resumen compacto para las tarjetas y la vista previa del escenario
export function InterviewSummary({ interview, className }) {
  if (!interview) return null;
  const level = AGGRESSIVENESS.find((a) => a.value === interview.aggressiveness) || AGGRESSIVENESS[1];
  const turns = interview.totalTurns ?? totalTurns(interview);
  // Duración MÁXIMA efectiva (no la estimación de referencia).
  const minutes = interview.estimatedMinutes ?? DEFAULT_MINUTES;
  return (
    <div className={className || 'flex flex-wrap items-center gap-2'}>
      <Badge tone="outline" icon="message">
        {turns} {turns === 1 ? 'pregunta' : 'preguntas'}
        {Number(interview.followUps) > 0 && ' (con repreguntas)'}
      </Badge>
      <Badge tone="outline" icon="clock">
        máx. {minutes} min{interview.estimatedMinutesAuto ? ' · predeterminado' : ''}
      </Badge>
      <Badge tone={level.tone === 'neutral' ? 'outline' : level.tone} icon="zap">
        Presión {level.label.toLowerCase()}
      </Badge>
    </div>
  );
}
