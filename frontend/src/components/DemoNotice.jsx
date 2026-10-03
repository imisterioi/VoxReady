import { useEffect, useState } from 'react';
import Icon from './Icon';
import { Button, Modal } from './ui';

// Aviso de la versión de demostración (solo en la versión publicada en Vercel).
// Se muestra la primera vez que se abre la demo; el botón "Demo" del switch de
// versiones lo vuelve a abrir (evento OPEN_EVENT).
const SEEN_KEY = 'voxready_demo_notice_v1';
export const OPEN_DEMO_NOTICE = 'voxready:demo-notice';

const POINTS = [
  { icon: 'eye', text: 'Fue diseñada para mostrar a grandes rasgos cómo funciona VoxReady y cómo se ve cada pantalla.' },
  { icon: 'sparkles', text: 'El entrevistador y la evaluación con IA están simulados: las preguntas y los puntajes son aproximados.' },
  { icon: 'database', text: 'Los datos son de ejemplo y se guardan solo en este navegador. Lo que crees aquí no lo verá nadie más.' },
  { icon: 'sliders', text: 'Algunas funciones se adaptaron para poder mostrarse sin servidor (por ejemplo, la grabación solo se puede ver en la misma pestaña), y otras pueden no funcionar.' },
];

const wasSeen = () => {
  try {
    return localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return false;
  }
};

export default function DemoNotice() {
  const [open, setOpen] = useState(() => !wasSeen());

  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(OPEN_DEMO_NOTICE, show);
    return () => window.removeEventListener(OPEN_DEMO_NOTICE, show);
  }, []);

  const close = () => {
    setOpen(false);
    try {
      localStorage.setItem(SEEN_KEY, '1');
    } catch {
      /* almacenamiento no disponible: se volverá a mostrar */
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="Versión de demostración"
      description="Esta no es la versión funcional ni final de VoxReady."
      footer={
        <Button onClick={close} iconRight="arrowRight">
          Entendido, ver la demo
        </Button>
      }
    >
      <ul className="space-y-3">
        {POINTS.map((p) => (
          <li key={p.icon} className="flex items-start gap-3">
            <span className="h-8 w-8 rounded-lg bg-accent-soft text-accent-fg flex items-center justify-center shrink-0">
              <Icon name={p.icon} size={16} />
            </span>
            <p className="text-sm text-muted leading-relaxed pt-1">{p.text}</p>
          </li>
        ))}
      </ul>
      <p className="mt-5 rounded-xl border border-line bg-subtle/60 px-4 py-3 text-[13px] text-ink leading-relaxed">
        La versión final se conecta a un servidor real, con inteligencia artificial y almacenamiento seguro de las prácticas.
      </p>
    </Modal>
  );
}
