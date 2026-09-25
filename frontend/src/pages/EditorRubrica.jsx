import { useState } from 'react';
import toast from 'react-hot-toast';
import I from '../data/dictionary';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  PageHeader,
  Segmented,
  cx
} from '../components/ui';

export default function EditorRubrica() {
  const t = I.es.L.m2;

  const [weights, setWeights] = useState(
    t.rows.map((r) => r[3])
  );

  const [level, setLevel] = useState('Alto');

  const [empathyDescription, setEmpathyDescription] = useState('');

  const [publishing, setPublishing] = useState(false);

  const total = weights.reduce((a, b) => a + b, 0);
  const valid = total === 100;

  const setWeight = (i, v) => {
    setWeights(
      weights.map((w, j) => (j === i ? v : w))
    );
  };

  const publishMasterPattern = async () => {
    if (!valid) {
      toast.error('Los pesos deben sumar 100%.');
      return;
    }

    if (!empathyDescription.trim()) {
      toast.error('Debes ingresar una descripción para empatía.');
      return;
    }

    try {
      setPublishing(true);

      const response = await fetch(
        'http://localhost:3000/api/master-pattern',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            email: 'vocero@demo.com',

            expressionWeight: weights[0],
            voiceToneWeight: weights[1],
            coherenceWeight: weights[2],
            empathyWeight: weights[3],

            empathyLevel: level,
            empathyDescription: empathyDescription.trim()
          })
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.mensaje || 'No se pudo publicar la rúbrica.'
        );
      }

      toast.success(
        `Patrón maestro v${data.masterPattern.version} publicado correctamente.`
      );

    } catch (error) {
      console.error('Error publicando patrón maestro:', error);

      toast.error(
        error.message || 'No se pudo publicar la rúbrica.'
      );

    } finally {
      setPublishing(false);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow={t.eyebrow}
        title={t.title}
        description={t.sub}
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() => toast.success('Borrador guardado')}
            >
              {t.draft}
            </Button>

            <Button
              disabled={!valid || publishing}
              onClick={publishMasterPattern}
              icon="check"
            >
              {publishing ? 'Publicando...' : t.publish}
            </Button>
          </>
        }
      />

      <Card className="mb-6">
        <CardHeader
          title={t.areasL}
          action={
            <Badge
              tone={valid ? 'success' : 'danger'}
              icon={valid ? 'check' : 'alert'}
            >
              Total {total}%
            </Badge>
          }
        />

        <div className="divide-y divide-line -mx-6 border-t border-line">
          {t.rows.map((row, i) => (
            <div
              key={row[0]}
              className="grid grid-cols-1 md:grid-cols-[1.2fr_1fr_1.6fr_220px] gap-3 md:gap-6 items-center px-6 py-5"
            >
              <div className="text-sm font-medium text-ink">
                {row[0]}
              </div>

              <div>
                <Badge tone="outline">
                  {row[1]}
                </Badge>
              </div>

              <div className="text-[13px] text-muted">
                {row[2]}
              </div>

              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min="0"
                  max="60"
                  step="5"
                  value={weights[i]}
                  onChange={(e) =>
                    setWeight(i, Number(e.target.value))
                  }
                  className="flex-1 accent-[rgb(var(--accent))]"
                  aria-label={`Peso de ${row[0]}`}
                />

                <span className="w-12 text-right text-sm font-semibold tabular-nums text-ink">
                  {weights[i]}%
                </span>
              </div>
            </div>
          ))}
        </div>

        <div className="flex h-2 rounded-full overflow-hidden mt-2 gap-0.5">
          {weights.map((w, i) => (
            <div
              key={i}
              style={{
                width: `${(w / Math.max(total, 1)) * 100}%`,
                background: `rgb(var(--c${i + 1}))`
              }}
            />
          ))}
        </div>

        {!valid && (
          <p className="text-xs text-danger mt-3">
            Los pesos deben sumar 100% para publicar.
          </p>
        )}
      </Card>

      <Card>
        <CardHeader
          title={t.descL}
          description="Área: empatía"
          action={
            <Segmented
              options={['Alto', 'Medio', 'Bajo']}
              value={level}
              onChange={setLevel}
            />
          }
        />

        <textarea
          className={cx('textarea min-h-[140px]')}
          value={empathyDescription}
          onChange={(e) =>
            setEmpathyDescription(e.target.value)
          }
          placeholder={`Nivel ${level.toLowerCase()}: ${t.descV}`}
        />
      </Card>
    </>
  );
}