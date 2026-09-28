import { Link, useNavigate, useParams } from 'react-router-dom';
import Icon from '../components/Icon';
import { Badge, Button, Card, EmptyState, PageHeader } from '../components/ui';
import { LESSONS, getLesson } from '../data/lessons';

const AREA_LABEL = { expression: 'Expresión', voice: 'Tono de voz', coherence: 'Coherencia', empathy: 'Empatía' };

// Catálogo de microlecciones (/vocero/leccion)
function LessonList() {
  return (
    <>
      <PageHeader
        eyebrow="Aprende entre prácticas"
        title="Microlecciones"
        description="Teoría breve, un video de expertos y un ejemplo comentado. Cada lección apunta a un área de tu informe."
      />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {LESSONS.map((l) => (
          <Link key={l.id} to={`/vocero/leccion/${l.id}`} className="group">
            <Card padded={false} className="overflow-hidden h-full flex flex-col hover:shadow-lift hover:border-line-strong transition-all">
              <div className="relative aspect-video bg-subtle overflow-hidden">
                <img
                  src={`https://i.ytimg.com/vi/${l.video.id}/hqdefault.jpg`}
                  alt=""
                  loading="lazy"
                  className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-300"
                />
                <span className="absolute inset-0 flex items-center justify-center">
                  <span className="h-12 w-12 rounded-full bg-white/95 text-[#0F1B2A] flex items-center justify-center shadow-lg">
                    <Icon name="play" size={18} className="ml-0.5" />
                  </span>
                </span>
              </div>
              <div className="p-5 flex-1 flex flex-col">
                <div className="flex items-center gap-2 mb-3">
                  <Badge tone="accent">{AREA_LABEL[l.area]}</Badge>
                  <Badge tone="outline" icon="clock">{l.minutes} min</Badge>
                </div>
                <h3 className="text-[15px] font-semibold text-ink">{l.title}</h3>
                <p className="text-[13px] text-muted mt-1.5 leading-relaxed flex-1">{l.objective}</p>
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </>
  );
}

// Detalle de una lección (/vocero/leccion/:id)
function LessonDetail({ lesson }) {
  const navigate = useNavigate();
  const index = LESSONS.indexOf(lesson);
  const next = LESSONS[(index + 1) % LESSONS.length];

  return (
    <div className="max-w-3xl mx-auto">
      <Button variant="ghost" size="sm" icon="arrowLeft" to="/vocero/leccion" className="-ml-3 mb-8">
        Todas las lecciones
      </Button>

      <div className="flex items-center gap-2 mb-4">
        <span className="eyebrow">Microlección · {AREA_LABEL[lesson.area]}</span>
        <Badge tone="outline" icon="clock">{lesson.minutes} min</Badge>
      </div>
      <h1 className="font-display font-semibold text-[36px] md:text-[48px] leading-[1.1] tracking-[-0.03em] text-ink">{lesson.title}</h1>

      <div className="mt-8 rounded-2xl border border-line bg-subtle/40 p-5 flex gap-4">
        <Icon name="target" size={20} className="text-accent mt-0.5" />
        <div>
          <div className="text-sm font-medium text-ink">Qué aprenderás</div>
          <p className="text-[15px] text-muted mt-1 leading-relaxed">{lesson.objective}</p>
        </div>
      </div>

      {/* Video público de YouTube (modo de privacidad mejorada) */}
      <div className="mt-8 aspect-video rounded-2xl overflow-hidden bg-[#0B1118] ring-1 ring-line">
        <iframe
          className="w-full h-full"
          src={`https://www.youtube-nocookie.com/embed/${lesson.video.id}?rel=0`}
          title={lesson.video.title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      </div>
      <p className="text-xs text-faint mt-2">
        Video: “{lesson.video.title}” · {lesson.video.author} (YouTube)
      </p>

      <h2 className="text-[15px] font-semibold text-ink mt-10 mb-4">Claves</h2>
      <ol className="space-y-3">
        {lesson.points.map((p, i) => (
          <li key={p} className="flex gap-3 text-[15px] text-ink leading-relaxed">
            <span className="h-6 w-6 rounded-full bg-accent-soft text-accent text-xs font-semibold flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
            {p}
          </li>
        ))}
      </ol>

      <h2 className="text-[15px] font-semibold text-ink mt-10 mb-4">Ejemplo comentado</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="p-5">
          <Badge tone="danger" icon="x">Antes</Badge>
          <p className="text-[15px] text-muted mt-4 leading-relaxed italic">{lesson.example.before}</p>
        </Card>
        <Card className="p-5 border-success/30">
          <Badge tone="success" icon="check">Después</Badge>
          <p className="text-[15px] text-ink mt-4 leading-relaxed">{lesson.example.after}</p>
        </Card>
      </div>

      <div className="mt-12 pt-8 border-t border-line flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <Button variant="ghost" iconRight="arrowRight" to={`/vocero/leccion/${next.id}`}>
          Siguiente: {next.title}
        </Button>
        <Button variant="accent" size="lg" iconRight="arrowRight" onClick={() => navigate('/vocero/escenarios')}>
          Practicar un escenario
        </Button>
      </div>
    </div>
  );
}

export default function Microleccion() {
  const { id } = useParams();
  if (!id) return <LessonList />;
  const lesson = getLesson(id);
  if (!lesson) {
    return (
      <Card className="max-w-xl mx-auto">
        <EmptyState icon="book" title="Lección no encontrada" action={<Button to="/vocero/leccion">Ver lecciones</Button>} />
      </Card>
    );
  }
  return <LessonDetail lesson={lesson} />;
}
