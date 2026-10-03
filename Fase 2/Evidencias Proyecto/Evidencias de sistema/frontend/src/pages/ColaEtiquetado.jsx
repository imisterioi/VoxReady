import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import I from '../data/dictionary';
import Icon from '../components/Icon';
import { Badge, Button, Card, EmptyState, PageHeader, cx } from '../components/ui';
import { apiFetch } from '../lib/api';
import SessionVideo from '../components/SessionVideo';
import useApiData from '../hooks/useApiData';
import { formatDate } from '../data/directory';

const AREAS = [
  { key: 'expression', label: 'Expresión' },
  { key: 'voice', label: 'Tono' },
  { key: 'coherence', label: 'Coherencia' },
  { key: 'empathy', label: 'Empatía' },
];

// Cola de etiquetado y segunda opinión (configurador maestro)
export default function ColaEtiquetado() {
  const t = I.es.L.m3;
  const queue = useApiData('/api/review-queue');
  const items = useMemo(() => queue.data?.items || [], [queue.data]);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [scores, setScores] = useState({});
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);

  const selected = items.find((i) => i.id === selectedId) || items[0];

  // Cargar el informe completo del caso seleccionado
  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    setDetail(null);
    apiFetch(`/api/sessions/${selected.id}`)
      .then(({ session }) => {
        if (cancelled) return;
        setDetail(session);
        const base = session.review?.scores || Object.fromEntries(session.report.areas.map((a) => [a.key, a.score ?? '']));
        setScores(Object.fromEntries(Object.entries(base).map(([k, v]) => [k, v ?? ''])));
        setComment(session.review?.comment || '');
      })
      .catch((err) => toast.error(err.message));
    return () => {
      cancelled = true;
    };
  }, [selected]);

  const aiScore = (key) => detail?.report.areas.find((a) => a.key === key)?.score;

  const confirm = async () => {
    try {
      setSaving(true);
      await apiFetch(`/api/sessions/${selected.id}/review`, { method: 'POST', body: { scores, comment } });
      toast.success(`Revisión guardada: ${selected.user.name}`);
      const next = items.find((i) => !i.review && i.id !== selected.id);
      if (next) setSelectedId(next.id);
      queue.reload();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const skip = () => {
    const idx = items.indexOf(selected);
    setSelectedId(items[(idx + 1) % items.length]?.id);
  };

  if (queue.loading && !queue.data) {
    return (
      <Card>
        <EmptyState icon="refresh" title="Cargando cola…" />
      </Card>
    );
  }

  return (
    <>
      <PageHeader eyebrow={t.eyebrow} title={t.title} description={t.sub} />

      {items.length === 0 ? (
        <Card>
          <EmptyState icon="tag" title="No hay prácticas evaluadas todavía" description="Cuando los voceros completen entrevistas, aparecerán aquí para revisión." />
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-6">
          {/* Cola */}
          <div>
            <div className="flex items-center justify-between mb-3 px-1">
              <span className="eyebrow">{t.queueL}</span>
              <Badge>{queue.data.pending} pendiente(s)</Badge>
            </div>
            <div className="space-y-2 max-h-[70vh] overflow-y-auto pr-1">
              {items.map((q) => (
                <button
                  key={q.id}
                  onClick={() => setSelectedId(q.id)}
                  className={cx(
                    'w-full text-left rounded-xl border p-4 transition-all',
                    q.id === selected?.id ? 'border-ink/50 bg-surface shadow-soft' : 'border-line bg-surface/50 hover:border-line-strong',
                    q.review && 'opacity-60',
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-ink truncate">{q.user.name}</span>
                    <span className="text-sm font-semibold tabular-nums text-ink">{q.score}</span>
                  </div>
                  <div className="text-xs text-muted truncate mt-0.5">
                    {q.theme?.title} · {q.tenant?.name}
                  </div>
                  <div className="mt-2">
                    {q.review ? <Badge tone="brand" icon="check">Revisado</Badge> : <Badge tone={q.reason.tone}>{q.reason.label}</Badge>}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Caso */}
          <Card>
            {!detail ? (
              <EmptyState icon="refresh" title="Cargando caso…" />
            ) : (
              <>
                <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
                  <div>
                    <div className="eyebrow">
                      {t.caseL} · {formatDate(detail.completedAt)}
                    </div>
                    <div className="text-xl font-semibold text-ink mt-1">{detail.user?.name}</div>
                    <div className="text-sm text-muted">{detail.theme?.title}</div>
                  </div>
                  <Button variant="secondary" size="sm" to={`/maestro/informe?sesion=${detail.id}`} iconRight="arrowRight">
                    Informe completo
                  </Button>
                </div>

                <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                  <div>
                    <SessionVideo key={detail.id} sessionId={detail.id} className="rounded-xl" />

                    <div className="mt-4 space-y-2 max-h-72 overflow-y-auto pr-1">
                      {(detail.transcript || []).map((turn, i) => (
                        <div key={i} className="rounded-xl bg-subtle/60 p-3 text-[13px]">
                          <p className="text-muted">
                            <b className="text-ink font-medium">P{i + 1}:</b> {turn.question}
                          </p>
                          <p className="text-ink mt-1.5">
                            <b className="font-medium">R:</b> {turn.answer || <i className="text-muted">(sin respuesta)</i>}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 gap-y-3 items-center text-sm">
                      <span className="text-xs text-muted">Área</span>
                      <span className="text-xs text-muted text-right">{t.proposal}</span>
                      <span className="text-xs text-muted text-right">{t.correction}</span>
                      {AREAS.map((a) => (
                        <div key={a.key} className="contents">
                          <span className="text-ink">{a.label}</span>
                          <span className="text-right tabular-nums text-muted">{aiScore(a.key) ?? '—'}</span>
                          <input
                            type="number"
                            min="0"
                            max="100"
                            value={scores[a.key] ?? ''}
                            placeholder="—"
                            onChange={(e) => setScores((s) => ({ ...s, [a.key]: e.target.value }))}
                            className={cx(
                              'input h-9 w-20 text-right tabular-nums',
                              scores[a.key] !== '' && Number(scores[a.key]) !== aiScore(a.key) && 'border-accent text-accent-fg',
                            )}
                          />
                        </div>
                      ))}
                    </div>

                    {detail.report.lineasRojas?.some((l) => l.cruzada) && (
                      <div className="mt-5 rounded-xl border border-danger/25 bg-danger/[0.04] p-3 text-xs text-ink space-y-1">
                        <div className="font-semibold text-danger flex items-center gap-1.5">
                          <Icon name="alert" size={13} /> Líneas rojas detectadas por la IA
                        </div>
                        {detail.report.lineasRojas
                          .filter((l) => l.cruzada)
                          .map((l) => (
                            <p key={l.linea}>
                              {l.linea} {l.evidencia && <i className="text-muted">— “{l.evidencia}”</i>}
                            </p>
                          ))}
                      </div>
                    )}

                    <div className="mt-5">
                      <label className="label">{t.commentL}</label>
                      <textarea className="textarea min-h-[96px]" placeholder={t.commentPh} value={comment} onChange={(e) => setComment(e.target.value)} />
                    </div>

                    <div className="flex gap-2 mt-5 pt-5 border-t border-line">
                      <Button icon="check" onClick={confirm} disabled={saving}>
                        {saving ? 'Guardando…' : detail.review ? 'Actualizar revisión' : t.confirm}
                      </Button>
                      <Button variant="ghost" onClick={skip} iconRight="arrowRight">
                        {t.skip}
                      </Button>
                    </div>
                    <p className="text-xs text-faint mt-3">
                      La corrección queda visible en el informe del vocero y alimenta la métrica de acuerdo IA-humano.{' '}
                      <Link to="/maestro/rubrica" className="underline">Ajustar patrón</Link>
                    </p>
                  </div>
                </div>
              </>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
