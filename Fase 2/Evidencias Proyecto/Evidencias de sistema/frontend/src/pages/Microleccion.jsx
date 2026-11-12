import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useI18n } from '../lib/i18n';
import Icon from '../components/Icon';
import { Badge, Button, Card, EmptyState, PageHeader } from '../components/ui';
import { API_URL, apiFetch, getToken } from '../lib/api';
import { lessonVideoUrl } from '../lib/practice/lessonVideo';

// Microlecciones del vocero (GET /api/micro-lessons).
//
// - Solo aparecen las lecciones ACTIVAS del idioma activo: lo filtra el BACKEND (no basta con
//   ocultarlas aquí) y el video se entrega por una ruta protegida.
// - Las recomendadas las marca el backend según el área más débil de la última práctica evaluada.
// - Los videos están alojados en VoxReady: no hay YouTube ni enlaces externos.
export default function Microleccion() {
  const { d } = useI18n();
  const t = d.L.u8;
  const { id } = useParams();
  const [state, setState] = useState({ loading: true, error: '', lessons: [] });

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: '' }));
    try {
      const { lessons } = await apiFetch('/api/micro-lessons');
      setState({ loading: false, error: '', lessons: lessons || [] });
    } catch (error) {
      setState({ loading: false, error: error.message, lessons: [] });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (state.loading) {
    return (
      <Card className="max-w-xl mx-auto">
        <EmptyState icon="refresh" title={t.loading} />
      </Card>
    );
  }

  if (state.error) {
    return (
      <Card className="max-w-xl mx-auto">
        <EmptyState
          icon="alert"
          title={t.error}
          description={state.error}
          action={
            <Button variant="secondary" icon="refresh" onClick={load}>
              {t.retry}
            </Button>
          }
        />
      </Card>
    );
  }

  if (!state.lessons.length) {
    return (
      <Card className="max-w-xl mx-auto">
        <EmptyState icon="book" title={t.empty} description={t.emptyHint} />
      </Card>
    );
  }

  if (id) {
    const lesson = state.lessons.find((item) => item.id === id);
    if (!lesson) {
      return (
        <Card className="max-w-xl mx-auto">
          <EmptyState icon="book" title={t.notFound} action={<Button to="/vocero/leccion">{t.viewLessons}</Button>} />
        </Card>
      );
    }
    return <LessonDetail lesson={lesson} lessons={state.lessons} />;
  }

  return <LessonList lessons={state.lessons} />;
}

// Reproductor del video alojado en VoxReady (ruta protegida con el token de la sesión).
function LessonVideo({ lesson, t }) {
  const [failed, setFailed] = useState(false);
  const src = lesson.hasVideo ? lessonVideoUrl(lesson.id, { apiUrl: API_URL, token: getToken() }) : null;

  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (!src || failed) {
    return (
      <div className="aspect-video rounded-2xl bg-[#0B1118] ring-1 ring-line flex flex-col items-center justify-center gap-2 text-center px-6">
        <Icon name={failed ? 'alert' : 'video'} size={24} className="text-faint" />
        <p className="text-sm text-muted">{failed ? t.videoError : t.noVideo}</p>
      </div>
    );
  }

  return (
    <video
      key={src}
      controls
      controlsList="nodownload noplaybackrate"
      disablePictureInPicture
      preload="metadata"
      onContextMenu={(event) => event.preventDefault()}
      onError={() => setFailed(true)}
      src={src}
      className="w-full aspect-video rounded-2xl bg-[#0B1118] ring-1 ring-line"
    />
  );
}

// Áreas de la rúbrica que refuerza la lección (etiquetas del idioma activo).
function AreaBadges({ lesson, t }) {
  return lesson.areas.map((area) => (
    <Badge key={area} tone="accent">
      {t.areaLabels[area] || area}
    </Badge>
  ));
}

// Catálogo (/vocero/leccion)
function LessonList({ lessons }) {
  const { d } = useI18n();
  const t = d.L.u8;
  return (
    <>
      <PageHeader eyebrow={t.eyebrow} title={t.title} description={t.sub} />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {lessons.map((lesson) => (
          <Link key={lesson.id} to={`/vocero/leccion/${lesson.id}`} className="group">
            <Card
              padded={false}
              className="overflow-hidden h-full flex flex-col hover:shadow-lift hover:border-line-strong transition-all"
            >
              <div className="relative aspect-video bg-subtle flex items-center justify-center">
                <Icon name={lesson.hasVideo ? 'play' : 'video'} size={22} className="text-faint" />
                {lesson.recommended && (
                  <span className="absolute top-3 left-3">
                    <Badge tone="success" icon="sparkles">
                      {t.recommended}
                    </Badge>
                  </span>
                )}
              </div>
              <div className="p-5 flex-1 flex flex-col">
                <div className="flex flex-wrap items-center gap-2 mb-3">
                  <AreaBadges lesson={lesson} t={t} />
                </div>
                <h3 className="text-[15px] font-semibold text-ink">{lesson.title}</h3>
                <p className="text-[13px] text-muted mt-1.5 leading-relaxed flex-1">{lesson.description}</p>
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </>
  );
}

// Detalle (/vocero/leccion/:id)
function LessonDetail({ lesson, lessons }) {
  const { d } = useI18n();
  const t = d.L.u8;
  const navigate = useNavigate();
  const index = lessons.findIndex((item) => item.id === lesson.id);
  const next = lessons[(index + 1) % lessons.length];
  const areaNames = lesson.areas.map((area) => t.areaLabels[area] || area).join(' · ');

  return (
    <div className="max-w-3xl mx-auto">
      <Button variant="ghost" size="sm" icon="arrowLeft" to="/vocero/leccion" className="-ml-3 mb-8">
        {t.backToCatalog}
      </Button>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <span className="eyebrow">{t.eyebrowDetail(areaNames)}</span>
        {lesson.recommended && (
          <Badge tone="success" icon="sparkles">
            {t.recommended}
          </Badge>
        )}
      </div>
      <h1 className="font-display font-semibold text-[36px] md:text-[44px] leading-[1.1] tracking-[-0.03em] text-ink">
        {lesson.title}
      </h1>
      <p className="text-[15px] text-muted mt-3 leading-relaxed">{lesson.description}</p>

      <div className="mt-6 rounded-2xl border border-line bg-subtle/40 p-5 flex gap-4">
        <Icon name="target" size={20} className="text-accent-fg mt-0.5" />
        <div>
          <div className="text-sm font-medium text-ink">{t.reinforces}</div>
          <div className="flex flex-wrap gap-2 mt-2">
            <AreaBadges lesson={lesson} t={t} />
          </div>
        </div>
      </div>

      <div className="mt-8">
        <LessonVideo lesson={lesson} t={t} />
      </div>

      {next && next.id !== lesson.id && (
        <div className="mt-12 pt-8 border-t border-line flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <Button variant="ghost" iconRight="arrowRight" to={`/vocero/leccion/${next.id}`}>
            {t.next(next.title)}
          </Button>
          <Button variant="accent" size="lg" iconRight="arrowRight" onClick={() => navigate('/vocero/escenarios')}>
            {t.practice}
          </Button>
        </div>
      )}
    </div>
  );
}

