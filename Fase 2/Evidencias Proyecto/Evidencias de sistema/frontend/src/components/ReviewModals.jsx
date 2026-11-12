import { useEffect, useState } from 'react';
import { useI18n } from '../lib/i18n';
import Icon from './Icon';
import { Badge, Button, Modal, Progress, cx } from './ui';
import { apiFetch } from '../lib/api';
import { resolveAreaScore } from '../lib/practice/reviewModel';

// Ventanas de edición del modo revisión. Muestran EL MISMO contenido que el informe (misma tarjeta,
// mismos textos) pero editable, y guardan en el BORRADOR sin publicar.
// Las etiquetas y los textos del informe vienen del diccionario del idioma activo.

const HIGHLIGHT = 'border-sky-200 bg-sky-50 dark:border-sky-500/30 dark:bg-sky-500/10';
const AREA_ICON = { expression: 'person', voice: 'mic', coherence: 'message', empathy: 'users' };

// Indicador de cambio de puntuación: triángulo y número del MISMO color (verde sube, rojo baja).
// Sin cambio no se muestra nada. Se comparte con el informe (mismo lenguaje visual).
export function ScoreDelta({ delta }) {
  if (!delta) return null;
  const up = delta > 0;
  return (
    <span
      aria-hidden="true"
      className={cx(
        'inline-block h-0 w-0 border-x-[5px] border-x-transparent align-middle',
        up ? 'border-b-[8px] border-b-success' : 'border-t-[8px] border-t-danger',
      )}
    />
  );
}

// Editor de un área: la tarjeta del informe (puntuación DERIVADA, subcriterios y textos) editable.
// La puntuación del área NO se edita a mano: se calcula a partir de sus subcriterios con la rúbrica y
// se muestra al instante, igual que el puntaje general.
export function AreaModal({ area, open, saving, previewGlobal, onSave, onClose }) {
  const { d } = useI18n();
  const t = d.L.u6;
  const [feedback, setFeedback] = useState('');
  const [details, setDetails] = useState({});

  // Al abrir se parte de lo que muestra el informe con la revisión aplicada.
  useEffect(() => {
    if (!open || !area) return;
    setFeedback(area.feedback || '');
    // Los subcriterios solo se puntúan (sin retroalimentación individual).
    setDetails(Object.fromEntries((area.details || []).map((item) => [item.key, { score: item.score ?? '' }])));
  }, [open, area]);

  if (!area) return null;

  // Cambios reales por subcriterio: solo los que DIFIEREN del valor original (comparando enteros).
  const edits = {};
  for (const item of area.details || []) {
    const value = details[item.key]?.score;
    const same = item.originalScore == null || Math.round(Number(value)) === Math.round(Number(item.originalScore));
    if (value !== '' && value != null && !same) edits[`${area.key}.${item.key}`] = { score: Math.round(Number(value)) };
  }

  // Cálculo EN VIVO con la MISMA regla que el servidor: media ponderada de los subcriterios.
  const liveArea = resolveAreaScore(
    {
      key: area.key,
      score: area.originalScore,
      details: (area.details || []).map((item) => ({ key: item.key, weight: item.weight, score: item.originalScore })),
    },
    edits,
  );
  const liveGlobal = previewGlobal ? previewGlobal(liveArea.score) : null;
  const areaDelta =
    liveArea.score != null && area.originalScore != null ? Math.sign(Math.round(liveArea.score) - Math.round(area.originalScore)) : 0;

  const save = () => {
    const detailPatch = {};
    for (const item of area.details || []) {
      const key = `${area.key}.${item.key}`;
      const value = details[item.key]?.score;
      const next = value === '' || value == null ? null : Math.round(Number(value));
      const changed = next != null && item.originalScore != null && next !== Math.round(Number(item.originalScore));
      // Solo se envían los subcriterios cuya puntuación cambia: así el área no se recalcula sin motivo.
      if (changed) detailPatch[key] = { score: next };
    }
    // La puntuación del área NO se envía: la deriva el servidor de los subcriterios.
    return onSave({ areas: { [area.key]: { feedback } }, details: detailPatch });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      width="max-w-2xl"
      title={area.label}
      description={t.editAreaHint}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            {t.close}
          </Button>
          <Button icon="check" onClick={save} disabled={saving}>
            {saving ? t.saving : t.saveChanges}
          </Button>
        </>
      }
    >
      <div className="rounded-2xl border border-line p-5">
        <div className="flex items-start justify-between gap-4">
          <span className="h-9 w-9 rounded-lg bg-subtle text-ink flex items-center justify-center shrink-0">
            <Icon name={AREA_ICON[area.key] || 'target'} size={16} />
          </span>
          <div className="text-right">
            <div className="text-[11px] text-muted">{t.aiScoreL}</div>
            <div className="text-sm font-semibold tabular-nums text-muted">{area.originalScore ?? '—'}</div>
          </div>
        </div>
        <div className="text-[13px] text-muted mt-4">{area.label}</div>
        {/* Puntuación DERIVADA de los subcriterios: se actualiza al instante y no es editable. */}
        <div
          className={cx(
            'text-[32px] font-semibold tracking-tight tabular-nums mt-1 mb-4 flex items-center gap-2',
            areaDelta > 0 ? 'text-success' : areaDelta < 0 ? 'text-danger' : 'text-ink',
          )}
        >
          {liveArea.score ?? '—'}
          <ScoreDelta delta={areaDelta} />
          <span className="text-sm text-faint font-normal">{t.outOf100}</span>
        </div>
        <Progress value={Number(liveArea.score ?? 0)} tone="accent" />
        <p className="text-[11px] text-faint mt-2">{t.derivedHint}</p>

        {liveGlobal != null && (
          <div className="mt-4 rounded-xl bg-subtle/60 px-4 py-3 flex items-center justify-between">
            <span className="text-[13px] text-muted">{t.globalL}</span>
            <span className="text-sm font-semibold tabular-nums text-ink">{liveGlobal}</span>
          </div>
        )}

        <label className="label mt-5">{t.areaFeedbackL}</label>
        <textarea
          className={cx('textarea min-h-[72px]', feedback && HIGHLIGHT)}
          value={feedback}
          onChange={(event) => setFeedback(event.target.value)}
          placeholder={t.feedbackPh}
        />

        {(area.details || []).length > 0 && (
          <div className="mt-5 pt-5 border-t border-line space-y-4">
            <div className="eyebrow">{t.subcriteriaL}</div>
            {area.details.map((item) => {
              const original = item.originalScore == null ? null : Math.round(Number(item.originalScore));
              const value = details[item.key]?.score ?? '';
              const next = value === '' || value == null ? original : Math.round(Number(value));
              const delta = next != null && original != null ? Math.sign(next - original) : 0;
              return (
                <div key={item.key}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span className="text-[13px] text-muted">
                      {item.label}
                      {item.value != null && (
                        <span className="text-faint">
                          {' '}
                          · {item.value}
                          {item.unit === '%' ? '%' : ''}
                        </span>
                      )}
                    </span>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="1"
                        value={value}
                        placeholder={original == null ? '—' : String(original)}
                        aria-label={`${item.label} · ${t.aiScoreL}`}
                        onChange={(event) =>
                          setDetails((current) => ({
                            ...current,
                            [item.key]: { ...current[item.key], score: event.target.value === '' ? '' : String(Math.round(Number(event.target.value))) },
                          }))
                        }
                        className={cx(
                          'input h-8 w-16 px-2 text-right text-[13px] tabular-nums',
                          delta !== 0 && (delta > 0 ? 'border-success text-success' : 'border-danger text-danger'),
                        )}
                      />
                      <span className={cx('flex items-center gap-0.5 text-[11px] tabular-nums w-8', delta > 0 ? 'text-success' : delta < 0 ? 'text-danger' : 'text-faint')}>
                        <ScoreDelta delta={delta} />
                      </span>
                      <span className="text-[11px] text-faint tabular-nums w-14 text-right">
                        {t.aiScoreL}: {original ?? '—'}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Modal>
  );
}

// Editor de un texto del informe: resumen, frase, «lo que hiciste bien», «lo que puedes mejorar» o el
// comentario de una pregunta. Se conservan los elementos (uno por elemento) para que el resaltado del
// informe del vocero sea POR FRAGMENTO y no de todo el apartado.
export function TextModal({ field, view, open, saving, onSave, onClose }) {
  const { d } = useI18n();
  const t = d.L.u6;
  const isList = field === 'fortalezas' || field === 'mejoras';
  const isQuestion = String(field).startsWith('question:');
  const questionKey = isQuestion ? String(field).slice('question:'.length) : null;

  const current = isList
    ? view.lists[field]?.values || []
    : isQuestion
      ? [view.questions[questionKey]?.value || '']
      : [view.texts[field]?.value || ''];

  const [items, setItems] = useState(current.length ? current : ['']);

  useEffect(() => {
    if (open) setItems(current.length ? current : ['']);
    // El contenido se reinicia solo al abrir o al cambiar de campo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, field]);

  const title = isList ? t.listLabels[field] : isQuestion ? t.questionLabel(questionKey) : t.textLabels[field];

  const save = () => {
    if (isList) return onSave({ lists: { [field]: items.map((item) => item.trim()).filter(Boolean) } });
    if (isQuestion) return onSave({ questions: { [questionKey]: items[0] } });
    return onSave({ texts: { [field]: items[0] } });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      width="max-w-2xl"
      title={title}
      description={isList ? t.listHint : t.textEditHint}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            {t.close}
          </Button>
          <Button icon="check" onClick={save} disabled={saving}>
            {saving ? t.saving : t.saveChanges}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {items.map((item, index) => (
          <div key={index} className="flex items-start gap-2">
            {isList && (
              <span className="mt-3 h-6 w-6 rounded-full bg-subtle text-muted text-xs font-semibold flex items-center justify-center shrink-0">
                {index + 1}
              </span>
            )}
            <textarea
              className={cx('textarea min-h-[64px]', item && HIGHLIGHT)}
              value={item}
              onChange={(event) =>
                setItems((values) => values.map((value, position) => (position === index ? event.target.value : value)))
              }
            />
            {isList && items.length > 1 && (
              <Button
                variant="ghost"
                size="sm"
                icon="trash"
                onClick={() => setItems((values) => values.filter((_, position) => position !== index))}
              >
                {t.remove}
              </Button>
            )}
          </div>
        ))}
        {isList && (
          <Button variant="secondary" size="sm" icon="plus" onClick={() => setItems((values) => [...values, ''])}>
            {t.addItem}
          </Button>
        )}
        <p className="text-xs text-faint">{t.fragmentHint}</p>
      </div>
    </Modal>
  );
}


// Consulta de la RÚBRICA con la que se generó el informe (versión HISTÓRICA, solo lectura).
export function RubricModal({ sessionId, open, onClose }) {
  const { d } = useI18n();
  const t = d.L.u6;
  const [state, setState] = useState({ loading: false, error: '', rubric: null });

  useEffect(() => {
    if (!open || !sessionId) return undefined;
    let cancelled = false;
    setState({ loading: true, error: '', rubric: null });
    apiFetch(`/api/sessions/${sessionId}/rubric`)
      .then(({ rubric }) => {
        if (!cancelled) setState({ loading: false, error: '', rubric });
      })
      .catch((error) => {
        if (!cancelled) setState({ loading: false, error: error.message, rubric: null });
      });
    return () => {
      cancelled = true;
    };
  }, [open, sessionId]);

  const rubric = state.rubric;

  return (
    <Modal
      open={open}
      onClose={onClose}
      width="max-w-2xl"
      title={t.rubricTitle}
      description={t.rubricHint}
      footer={
        <Button variant="secondary" onClick={onClose}>
          {t.close}
        </Button>
      }
    >
      {state.loading && <p className="text-sm text-muted">{t.rubricLoading}</p>}
      {state.error && <p className="text-sm text-danger">{state.error}</p>}
      {rubric && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="brand" icon="sliders">
              {rubric.pattern?.name || (rubric.patternVersion ? t.masterPatternOf(rubric.patternVersion) : t.defaultWeights)}
            </Badge>
            {rubric.pattern?.version != null && <Badge tone="outline">{t.versionOf(rubric.pattern.version)}</Badge>}
            {rubric.pattern?.source && <Badge tone="outline">{t.sourceOf(rubric.pattern.source)}</Badge>}
            {rubric.strictness && <Badge tone="outline">{t.strictnessOf(rubric.strictness)}</Badge>}
          </div>

          {rubric.descriptors?.coherence && (
            <div>
              <div className="eyebrow">{t.descriptorL}</div>
              <p className="text-[13px] text-muted mt-1">{rubric.descriptors.coherence}</p>
              {rubric.descriptors.empathy && <p className="text-[13px] text-muted mt-1">{rubric.descriptors.empathy}</p>}
            </div>
          )}

          {rubric.areas.map((area) => (
            <div key={area.key} className="rounded-xl border border-line p-4">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium text-ink">{area.label}</span>
                <span className="text-xs text-faint">{t.weightOf(area.weight)}</span>
              </div>
              <ul className="mt-3 space-y-1.5">
                {area.details.map((detail) => (
                  <li key={detail.key} className="flex items-center justify-between gap-3 text-[13px]">
                    <span className="text-muted">{detail.label}</span>
                    <span className="text-faint tabular-nums">{t.weightOf(detail.weight)}</span>
                  </li>
                ))}
              </ul>
              {area.source && <p className="text-[11px] text-faint mt-3">{area.source}</p>}
            </div>
          ))}

          <p className="text-xs text-faint">{t.rubricReadOnly}</p>
        </div>
      )}
    </Modal>
  );
}

