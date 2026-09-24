import { useState } from 'react';
import toast from 'react-hot-toast';
import I from '../data/dictionary';
import Icon from '../components/Icon';
import { Badge, Button, Card, PageHeader, cx } from '../components/ui';

export default function ColaEtiquetado() {
  const t = I.es.L.m3;
  const areaScores = [70, 81, 79, 58];
  const [selected, setSelected] = useState(0);
  const [scores, setScores] = useState(areaScores);
  const caso = t.queue[selected];

  const next = () => {
    setSelected((s) => (s + 1) % t.queue.length);
    setScores(areaScores);
  };

  return (
    <>
      <PageHeader eyebrow={t.eyebrow} title={t.title} description={t.sub} />

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
        {/* Cola */}
        <div>
          <div className="flex items-center justify-between mb-3 px-1">
            <span className="eyebrow">{t.queueL}</span>
            <Badge>23</Badge>
          </div>
          <div className="space-y-2">
            {t.queue.map((q, i) => (
              <button
                key={q.id}
                onClick={() => {
                  setSelected(i);
                  setScores(areaScores);
                }}
                className={cx(
                  'w-full text-left rounded-xl border p-4 transition-all',
                  i === selected ? 'border-ink/50 bg-surface shadow-soft' : 'border-line bg-surface/50 hover:border-line-strong',
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-ink tabular-nums">#{q.id}</span>
                  <span className={cx('h-2 w-2 rounded-full', q.tone === 'danger' ? 'bg-danger' : q.tone === 'warning' ? 'bg-warning' : 'bg-faint')} />
                </div>
                <div className="text-xs text-muted mt-1">{q.reason}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Caso */}
        <Card>
          <div className="flex items-center justify-between mb-6">
            <div>
              <div className="eyebrow">{t.caseL}</div>
              <div className="text-xl font-semibold text-ink tabular-nums mt-1">#{caso.id}</div>
            </div>
            <Badge tone={caso.tone}>{caso.reason}</Badge>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="relative aspect-video rounded-xl overflow-hidden bg-gradient-to-br from-[#1C242E] to-[#0B1118] flex items-center justify-center">
              <span className="h-12 w-12 rounded-full bg-white/90 text-[#0F1B2A] flex items-center justify-center">
                <Icon name="play" size={18} className="ml-0.5" />
              </span>
              <span className="absolute bottom-3 left-3 text-xs text-white/60">{t.rec} · 6:12</span>
            </div>

            <div>
              <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 gap-y-3 items-center text-sm">
                <span className="text-xs text-muted">Área</span>
                <span className="text-xs text-muted text-right">{t.proposal}</span>
                <span className="text-xs text-muted text-right">{t.correction}</span>
                {t.areas.map((n, i) => (
                  <div key={n} className="contents">
                    <span className="text-ink">{n}</span>
                    <span className="text-right tabular-nums text-muted">{areaScores[i]}</span>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={scores[i]}
                      onChange={(e) => setScores(scores.map((s, j) => (j === i ? Number(e.target.value) : s)))}
                      className={cx(
                        'input h-9 w-20 text-right tabular-nums',
                        scores[i] !== areaScores[i] && 'border-accent text-accent',
                      )}
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-6">
            <label className="label">{t.commentL}</label>
            <textarea key={caso.id} className="textarea min-h-[96px]" placeholder={t.commentPh} />
          </div>

          <div className="flex gap-2 mt-6 pt-6 border-t border-line">
            <Button
              icon="check"
              onClick={() => {
                toast.success(`Caso #${caso.id} confirmado`);
                next();
              }}
            >
              {t.confirm}
            </Button>
            <Button variant="ghost" onClick={next} iconRight="arrowRight">
              {t.skip}
            </Button>
          </div>
        </Card>
      </div>
    </>
  );
}
