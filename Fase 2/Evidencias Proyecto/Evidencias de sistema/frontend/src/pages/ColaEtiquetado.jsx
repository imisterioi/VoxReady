import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useI18n } from '../lib/i18n';
import Icon from '../components/Icon';
import { Badge, Button, Card, EmptyState, PageHeader, cx } from '../components/ui';
import { apiFetch } from '../lib/api';
import SessionVideo from '../components/SessionVideo';
import useApiData from '../hooks/useApiData';
import { formatDate } from '../data/directory';

const AREAS = ['expression', 'voice', 'coherence', 'empathy'];

// Cola de etiquetado y segunda opinión (configurador maestro)
export default function ColaEtiquetado() {
  const { d, lang } = useI18n();
  const t = d.L.m3;
  const areaLabels = t.areaLabels;
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
      toast.success(t.reviewSaved(selected.user.name));
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
        <EmptyState icon="refresh" title={t.loading} />
      </Card>
    );
  }

  return (
    <>
      <PageHeader eyebrow={t.eyebrow} title={t.title} description={t.sub} />

      {items.length === 0 ? (
        <Card>
          <EmptyState icon="tag" title={t.empty} description={t.emptyDesc} />
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-6">
          {/* Cola */}
          <div>
            <div className="flex items-center justify-between mb-3 px-1">
              <span className="eyebrow">{t.queueL}</span>
              <Badge>{t.pending(queue.data.pending)}</Badge>
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
                    {q.review ? <Badge tone="brand" icon="check">{t.reviewed}</Badge> : <Badge tone={q.reason.tone}>{q.reason.label}</Badge>}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Caso */}
          <Card>
            {!detail ? (
              <EmptyState icon="refresh" title={t.loadingCase} />
            ) : (
              <>
                <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
                  <div>
                    <div className="eyebrow">
                      {t.caseL} · {formatDate(detail.completedAt, lang)}
                    </div>
                    <div className="text-xl font-semibold text-ink mt-1">{detail.user?.name}</div>
                    <div className="text-sm text-muted">{detail.theme?.title}</div>
                  </div>
                  <Button variant="secondary" size="sm" to={`/maestro/informe?sesion=${detail.id}`} iconRight="arrowRight">
                    {t.fullReport}
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
                            <b className="font-medium">R:</b> {turn.answer || <i className="text-muted">{t.noAnswer}</i>}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 gap-y-3 items-center text-sm">
                      <span className="text-xs text-muted">{t.areaL}</span>
                      <span className="text-xs text-muted text-right">{t.proposal}</span>
                      <span className="text-xs text-muted text-right">{t.correction}</span>
                      {AREAS.map((key) => (
                        <div key={key} className="contents">
                          <span className="text-ink">{areaLabels[key]}</span>
                          <span className="text-right tabular-nums text-muted">{aiScore(key) ?? '—'}</span>
                          <input
                            type="number"
                            min="0"
                            max="100"
                            value={scores[key] ?? ''}
                            placeholder="—"
                            onChange={(e) => setScores((s) => ({ ...s, [key]: e.target.value }))}
                            className={cx(
                              'input h-9 w-20 text-right tabular-nums',
                              scores[key] !== '' && Number(scores[key]) !== aiScore(key) && 'border-accent text-accent-fg',
                            )}
                          />
                        </div>
                      ))}
                    </div>

                    {detail.report.lineasRojas?.some((l) => l.cruzada) && (
                      <div className="mt-5 rounded-xl border border-danger/25 bg-danger/[0.04] p-3 text-xs text-ink space-y-1">
                        <div className="font-semibold text-danger flex items-center gap-1.5">
                          <Icon name="alert" size={13} /> {t.redLinesDetected}
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
                        {saving ? t.saving : detail.review ? t.update : t.confirm}
                      </Button>
                      <Button variant="ghost" onClick={skip} iconRight="arrowRight">
                        {t.skip}
                      </Button>
                    </div>
                    <p className="text-xs text-faint mt-3">
                      {t.footer}{' '}
                      <Link to="/maestro/rubrica" className="underline">{t.adjustPattern}</Link>
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
