import { useState } from 'react';
import Icon from '../components/Icon';
import PracticeSteps from '../components/PracticeSteps';
import { Badge, Button, Card, PageHeader, cx } from '../components/ui';

/*
 * LABORATORIO · Reconstrucción de la interfaz ANTERIOR de la sesión del vocero.
 *
 * Contexto (recuperado del historial de Git):
 *   El diseño original mostraba DOS pantallas del mismo tamaño, una al lado de la otra:
 *   el entrevistador virtual a la izquierda y la cámara del vocero a la derecha, con la
 *   pregunta de la entrevista centrada justo debajo.
 *
 *   Ese diseño se alteró en el push 61e654001 ("feat: integra los cambios de Specols en la
 *   versión de demostración"), que sustituyó la grilla equilibrada `grid grid-cols-1
 *   md:grid-cols-2` por una distribución asimétrica (cámara grande `1.6fr` a la izquierda y
 *   panel lateral `1fr` a la derecha).
 *
 *   Esta página es solo VISUAL: reproduce ambas versiones con datos simulados para poder
 *   compararlas sin tocar el flujo real de la sesión (/vocero/sesion).
 */

const DEMO = {
  question: 'Cuéntame sobre un desafío reciente en tu trabajo y cómo lo resolviste.',
  scenario: 'Entrevista laboral · Comunicación',
  mainLabel: 'Pregunta principal 2 de 5',
  status: 'Escuchando tu respuesta…',
  seconds: 42,
  micLevel: 0.55,
  mainsAsked: 2,
  mainsTotal: 5,
};

function formatTime(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// Nivel del micrófono (simulado): cinco barras que suben según `level`.
function MicBars({ level }) {
  return (
    <div className="flex items-end gap-[2px] h-7 rounded-full bg-black/60 backdrop-blur px-3 py-2">
      {[0.15, 0.3, 0.45, 0.6, 0.75].map((th) => (
        <span
          key={th}
          className={cx('w-1 rounded-full transition-colors', level > th * 0.5 ? 'bg-emerald-400' : 'bg-white/25')}
          style={{ height: `${30 + th * 90}%` }}
        />
      ))}
    </div>
  );
}

function BodyBadge() {
  return (
    <div className="flex items-center gap-1.5 rounded-full bg-black/60 backdrop-blur px-3 h-7 text-white text-xs">
      <Icon name="person" size={12} className="text-emerald-400" />
      Cuerpo detectado
    </div>
  );
}

// Placeholder de la cámara del vocero (sin acceso real a la cámara).
function CameraPlaceholder() {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-gradient-to-br from-[#1C242E] to-[#12181F]">
      <svg viewBox="0 0 100 100" className="h-28 text-white/10" fill="currentColor" aria-hidden="true">
        <circle cx="50" cy="38" r="16" />
        <path d="M18 94c0-19 14-32 32-32s32 13 32 32z" />
      </svg>
      <span className="text-xs text-white/40">Cámara del vocero (simulada)</span>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * DISEÑO ANTERIOR (el que queremos recuperar)
 * Estructura exacta recuperada de SesionPractica.jsx en el commit 61e654001^:
 *   - Contenedor oscuro con `grid grid-cols-1 md:grid-cols-2 gap-3`.
 *   - Columna izquierda: Entrevistador IA (aspect-[4/3]).
 *   - Columna derecha:  Cámara del vocero (aspect-[4/3], mismo tamaño).
 *   - Debajo, centrada: la pregunta de la entrevista.
 *   - Luego: avisos y controles; al final, la pista de audífonos.
 * ------------------------------------------------------------------------- */
function DisenoAnterior() {
  const pct = (DEMO.mainsAsked / DEMO.mainsTotal) * 100;

  return (
    <>
      <PracticeSteps />

      <div className="rounded-[28px] bg-[#0B1118] p-3 md:p-4 ring-1 ring-black/5 shadow-lift">
        {/* Dos pantallas del mismo tamaño, una al lado de la otra */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* Entrevistador IA (izquierda) */}
          <div className="relative aspect-[4/3] rounded-2xl overflow-hidden bg-gradient-to-br from-[#16263A] to-[#0E1824] flex items-center justify-center">
            <div className="relative">
              <span className="absolute inset-0 rounded-full bg-accent/30 animate-pulse-ring" />
              <span className="relative h-24 w-24 rounded-full flex items-center justify-center text-white shadow-2xl transition-all duration-300 bg-gradient-to-br from-accent to-brand-deep scale-105">
                <Icon name="sparkles" size={34} strokeWidth={1.5} />
              </span>
            </div>
            <div className="absolute top-4 left-4 flex items-center gap-2 rounded-full bg-white/10 backdrop-blur px-3 h-7 text-white/90 text-xs">
              <span className="h-1.5 w-1.5 rounded-full bg-accent-bright animate-pulse" />
              Entrevistador
            </div>
            <div className="absolute bottom-4 inset-x-4 text-center text-[11px] text-white/40 truncate">{DEMO.scenario}</div>
          </div>

          {/* Cámara del vocero (derecha) */}
          <div className="relative aspect-[4/3] rounded-2xl overflow-hidden bg-black">
            <CameraPlaceholder />

            <div className="absolute top-4 right-4 flex items-center gap-2 rounded-full bg-black/60 backdrop-blur px-3 h-7 text-white text-xs tabular-nums">
              <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
              REC {formatTime(DEMO.seconds)}
            </div>
            <div className="absolute bottom-4 left-4 flex items-center gap-2">
              <MicBars level={DEMO.micLevel} />
              <BodyBadge />
            </div>
          </div>
        </div>

        {/* Pregunta y respuesta en vivo: centradas, debajo de ambas pantallas */}
        <div className="px-4 md:px-8 pt-8 pb-6 text-center min-h-[180px]">
          <div className="text-[11px] uppercase tracking-[0.14em] text-white/40 mb-4">{DEMO.mainLabel}</div>
          <p className="font-display font-medium text-[22px] md:text-[28px] leading-[1.35] tracking-[-0.015em] text-white max-w-3xl mx-auto">
            “{DEMO.question}”
          </p>
          <p className="mt-5 text-sm text-white/60 max-w-2xl mx-auto leading-relaxed">
            Habla con naturalidad: tu respuesta se transcribirá al finalizar la sesión.
          </p>
          <p className="mt-4 text-xs text-white/40 flex items-center justify-center gap-1.5">
            <Icon name="clock" size={12} /> {DEMO.status}
          </p>
        </div>

        {/* Controles */}
        <div className="flex flex-col md:flex-row md:items-center gap-3 rounded-2xl bg-white/[0.04] p-3 md:p-4">
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="h-11 px-4 rounded-xl hover:bg-red-500/10 text-white/60 hover:text-red-300 text-sm font-medium inline-flex items-center gap-2 transition-colors"
            >
              <Icon name="x" size={16} /> Descartar
            </button>
            <button
              type="button"
              className="h-11 px-4 rounded-xl hover:bg-white/10 text-white/70 hover:text-white text-sm font-medium inline-flex items-center gap-2 transition-colors"
            >
              <Icon name="repeat" size={16} /> Repetir
            </button>
          </div>

          <div className="flex items-center gap-3 md:flex-1 md:max-w-xs md:mx-auto">
            <div className="flex-1 h-1 rounded-full bg-white/10 overflow-hidden">
              <div className="h-full rounded-full bg-accent-bright transition-all duration-500" style={{ width: `${pct}%` }} />
            </div>
            <span className="text-xs text-white/50 whitespace-nowrap tabular-nums">
              {DEMO.mainsAsked} de {DEMO.mainsTotal} principales
            </span>
          </div>

          <div className="flex items-center gap-2 md:ml-auto">
            <button
              type="button"
              className="h-11 px-4 rounded-xl hover:bg-white/10 text-white/70 hover:text-white text-sm font-medium transition-colors"
            >
              Finalizar
            </button>
            <Button variant="accent" size="lg">Terminé de responder</Button>
          </div>
        </div>
      </div>

      <p className="text-center text-xs text-faint mt-6 flex items-center justify-center gap-1.5">
        <Icon name="info" size={13} /> Usa audífonos para que el micrófono no capte la voz del entrevistador.
      </p>
    </>
  );
}

/* ---------------------------------------------------------------------------
 * DISEÑO ACTUAL (posterior al push 61e654001)
 * Estructura tomada de SesionPractica.jsx en HEAD:
 *   - Cámara del vocero grande a la izquierda (grid-cols-[minmax(0,1.6fr)_...]).
 *   - Entrevistador, pregunta y controles en un panel lateral a la derecha (1fr).
 * ------------------------------------------------------------------------- */
function DisenoActual() {
  const pct = (DEMO.mainsAsked / DEMO.mainsTotal) * 100;

  return (
    <>
      <PracticeSteps className="!mb-4" />

      <div className="rounded-[28px] bg-[#0B1118] p-3 ring-1 ring-black/5 shadow-lift grid grid-cols-1 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] gap-3 lg:min-h-[440px] lg:max-h-[760px]">
        {/* Cámara del vocero (izquierda, grande) */}
        <div className="relative h-[56vw] lg:h-auto rounded-2xl overflow-hidden bg-black">
          <CameraPlaceholder />

          <div className="absolute top-4 right-4 flex items-center gap-2 rounded-full bg-black/60 backdrop-blur px-3 h-7 text-white text-xs tabular-nums">
            <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
            REC {formatTime(DEMO.seconds)}
          </div>
          <div className="absolute bottom-4 left-4 flex items-center gap-2">
            <MicBars level={DEMO.micLevel} />
            <BodyBadge />
          </div>
        </div>

        {/* Entrevistador, pregunta y controles (derecha) */}
        <div className="flex flex-col gap-3 min-h-0">
          {/* Entrevistador IA */}
          <div className="flex items-center gap-4 rounded-2xl bg-gradient-to-br from-[#16263A] to-[#0E1824] px-4 py-3">
            <div className="relative shrink-0">
              <span className="absolute inset-0 rounded-full bg-accent/30 animate-pulse-ring" />
              <span className="relative h-14 w-14 rounded-full flex items-center justify-center text-white shadow-2xl transition-all duration-300 bg-gradient-to-br from-accent to-brand-deep scale-105">
                <Icon name="sparkles" size={24} strokeWidth={1.5} />
              </span>
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-sm font-medium text-white/90">
                <span className="h-1.5 w-1.5 rounded-full bg-accent-bright animate-pulse" />
                Entrevistador
              </div>
              <div className="text-xs text-white/40 truncate mt-0.5">{DEMO.scenario}</div>
            </div>
          </div>

          {/* Pregunta y respuesta */}
          <div className="flex-1 min-h-0 overflow-y-auto rounded-2xl bg-white/[0.03] px-5 py-4 flex flex-col">
            <div className="text-[11px] uppercase tracking-[0.14em] text-white/40 mb-2">{DEMO.mainLabel}</div>
            <p className="font-display font-medium text-[19px] xl:text-[21px] leading-[1.3] tracking-[-0.015em] text-white">
              “{DEMO.question}”
            </p>
            <p className="mt-3 text-sm text-white/60 leading-relaxed">
              Habla con naturalidad: tu respuesta se transcribirá al finalizar la sesión.
            </p>
            <p className="mt-auto pt-3 text-xs text-white/40 flex items-center gap-1.5">
              <Icon name="clock" size={12} /> {DEMO.status}
            </p>
          </div>

          {/* Controles */}
          <div className="rounded-2xl bg-white/[0.04] p-3 space-y-3">
            <div className="flex items-center gap-3 px-1">
              <div className="flex-1 h-1 rounded-full bg-white/10 overflow-hidden">
                <div className="h-full rounded-full bg-accent-bright transition-all duration-500" style={{ width: `${pct}%` }} />
              </div>
              <span className="text-xs text-white/50 whitespace-nowrap tabular-nums">
                {DEMO.mainsAsked} de {DEMO.mainsTotal} principales
              </span>
            </div>

            <Button variant="accent" size="lg" className="w-full">Terminé de responder</Button>

            <div className="flex items-center justify-between gap-1">
              <button
                type="button"
                className="h-9 px-3 rounded-xl hover:bg-red-500/10 text-white/60 hover:text-red-300 text-[13px] font-medium inline-flex items-center gap-1.5 transition-colors"
              >
                <Icon name="x" size={15} /> Descartar
              </button>
              <button
                type="button"
                className="h-9 px-3 rounded-xl hover:bg-white/10 text-white/70 hover:text-white text-[13px] font-medium inline-flex items-center gap-1.5 transition-colors"
              >
                <Icon name="repeat" size={15} /> Repetir
              </button>
              <button
                type="button"
                className="h-9 px-3 rounded-xl hover:bg-white/10 text-white/70 hover:text-white text-[13px] font-medium transition-colors"
              >
                Finalizar
              </button>
            </div>
          </div>

          <p className="text-[11px] text-white/30 flex items-start gap-1.5 px-1">
            <Icon name="info" size={12} className="mt-0.5 shrink-0" /> Usa audífonos para que el micrófono no capte la voz del entrevistador.
          </p>
        </div>
      </div>
    </>
  );
}

export default function LaboratorioSesionVocero() {
  const [vista, setVista] = useState('anterior');

  return (
    <>
      <PageHeader
        eyebrow="Laboratorio · Reconstrucción visual"
        title="Sesión del vocero · diseño anterior"
        description="Comparación del diseño anterior (dos pantallas del mismo tamaño: entrevistador a la izquierda, cámara a la derecha y preguntas centradas debajo) con la interfaz actual. Solo aspecto visual, con datos simulados."
      />

      <Card padded={false} className="mb-6 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex rounded-xl border border-line bg-subtle p-1">
            <button
              type="button"
              onClick={() => setVista('anterior')}
              className={cx(
                'h-9 px-4 rounded-lg text-[13px] font-medium transition-colors',
                vista === 'anterior' ? 'bg-surface text-ink shadow-soft' : 'text-muted hover:text-ink',
              )}
            >
              Diseño anterior (recuperado)
            </button>
            <button
              type="button"
              onClick={() => setVista('actual')}
              className={cx(
                'h-9 px-4 rounded-lg text-[13px] font-medium transition-colors',
                vista === 'actual' ? 'bg-surface text-ink shadow-soft' : 'text-muted hover:text-ink',
              )}
            >
              Diseño actual
            </button>
          </div>

          <Badge tone={vista === 'anterior' ? 'success' : 'neutral'}>
            {vista === 'anterior'
              ? '2 pantallas iguales · entrevistador ← · cámara →'
              : 'cámara grande ← · panel lateral →'}
          </Badge>
        </div>

        <p className="text-[13px] text-muted mt-3 leading-relaxed">
          {vista === 'anterior'
            ? 'Diseño original: dos columnas equilibradas (grid grid-cols-1 md:grid-cols-2) con el entrevistador virtual a la izquierda y la cámara del vocero a la derecha, y la pregunta de la entrevista centrada debajo.'
            : 'Interfaz actual: la cámara del vocero ocupa el alto de la pantalla (1.6fr) y el entrevistador, la pregunta y los controles van en un panel lateral (1fr).'}
        </p>
      </Card>

      {vista === 'anterior' ? <DisenoAnterior /> : <DisenoActual />}
    </>
  );
}
