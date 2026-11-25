import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useI18n } from '../lib/i18n';
import Icon from '../components/Icon';
import { Badge, Button, Card, EmptyState, PageHeader } from '../components/ui';
import { API_URL, apiFetch, getToken } from '../lib/api';
import { lessonVideoUrl, parseLessonVideoUrl } from '../lib/practice/lessonVideo';
import { useVideoFrame, useYoutubePoster } from '../hooks/useLessonMedia';

// Microlecciones del vocero (GET /api/micro-lessons).
//
// - Solo aparecen las lecciones ACTIVAS del idioma activo: lo filtra el BACKEND (no basta con
//   ocultarlas aquí) y el video se entrega por una ruta protegida.
// - Las recomendadas las marca el backend: las de rúbrica según el área más débil de la última
//   práctica evaluada y las GENERALES siempre (refuerzo transversal).
// - El video puede estar alojado en VoxReady (ruta protegida) o ser un ENLACE EXTERNO validado
//   (p. ej. YouTube), que se integra con un reproductor embebido sin salir de la aplicación.
// - Cada tarjeta del catálogo muestra una MINIATURA real del video (portada de YouTube o primer
//   fotograma del archivo), en 16:9 y sin deformar; si no hay video, se mantiene el icono.
export default function Microleccion() {
  const { d, langVersion } = useI18n();
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

  // El catálogo lo filtra el BACKEND por el idioma del usuario: hay que volver a pedirlo cuando el
  // idioma efectivo cambia (`langVersion` solo cambia con un cambio real), sin recargar la página.
  useEffect(() => {
    load();
  }, [load, langVersion]);

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

// Reproductor del video de la lección:
//  - VIDEO EXTERNO (p. ej. YouTube): se integra con un <iframe> construido desde el identificador
//    validado (youtube-nocookie). Nunca se navega fuera ni se inyecta HTML del usuario. Si el
//    propietario deshabilitó la inserción, el propio reproductor lo indica y se ofrece un enlace
//    manual (solo al pulsarlo) para verlo en YouTube.
//  - VIDEO SUBIDO A VOXREADY: se sirve por la ruta protegida con el token de la sesión.
function LessonVideo({ lesson, t }) {
  const [failed, setFailed] = useState(false);
  const external = lesson.videoSource === 'external' ? parseLessonVideoUrl(lesson.videoUrl) : null;
  const src = !external && lesson.hasVideo ? lessonVideoUrl(lesson.id, { apiUrl: API_URL, token: getToken() }) : null;

  useEffect(() => {
    setFailed(false);
  }, [src, lesson.videoUrl]);

  if (external) {
    return (
      <div>
        <div className="relative w-full aspect-video rounded-2xl overflow-hidden bg-[#0B1118] ring-1 ring-line">
          <iframe
            title={lesson.title}
            src={external.embedUrl}
            className="absolute inset-0 h-full w-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            referrerPolicy="strict-origin-when-cross-origin"
            allowFullScreen
            loading="lazy"
          />
        </div>
        <p className="text-xs text-faint mt-2 leading-relaxed">
          {t.externalVideoNote}{' '}
          <a
            href={external.watchUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-muted hover:text-ink underline"
          >
            {t.watchOnYouTube}
          </a>
        </p>
      </div>
    );
  }

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

// Miniatura de la tarjeta del catálogo. Muestra una imagen representativa del video asociado:
//  - ENLACE EXTERNO (YouTube): su portada real (derivada del identificador validado).
//  - ARCHIVO SUBIDO: el primer fotograma, leído desde su RUTA PROTEGIDA con el token de la sesión.
//  - SIN VIDEO (o si no se puede obtener la imagen): el icono, como hasta ahora.
// La caja de la tarjeta ya reserva la proporción 16:9, así que la imagen no provoca saltos de diseño.
function LessonThumb({ lesson }) {
  const external = lesson.videoSource === 'external' ? parseLessonVideoUrl(lesson.videoUrl) : null;
  // Portada en calidad de miniatura: `hqdefault` ya existe en cualquier vídeo válido, así que evita
  // un 404 innecesario por tarjeta (el formulario de administración usa la portada grande).
  const poster = useYoutubePoster(external, { quality: 'sd' });
  const frame = useVideoFrame(
    !external && lesson.videoSource === 'upload' ? lessonVideoUrl(lesson.id, { apiUrl: API_URL, token: getToken() }) : null,
  );

  const youtube = external ? poster.url : null;
  const thumbnail = youtube || (frame.status === 'ok' ? frame.frame : null);

  if (thumbnail) {
    return (
      <img
        src={thumbnail}
        alt=""
        loading="lazy"
        onError={youtube ? poster.onError : undefined}
        className="absolute inset-0 h-full w-full object-cover"
      />
    );
  }

  return <Icon name={lesson.hasVideo ? 'play' : 'video'} size={22} className="text-faint" />;
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
              <div className="relative aspect-video bg-subtle flex items-center justify-center overflow-hidden">
                <LessonThumb lesson={lesson} />
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

