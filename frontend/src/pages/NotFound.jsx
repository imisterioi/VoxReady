import { useNavigate } from 'react-router-dom';
import { homeFor } from '../data/mockData';
import { Button } from '../components/ui';

export default function NotFound() {
  const navigate = useNavigate();
  const user = JSON.parse(localStorage.getItem('voxready_user') || 'null');

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
      <span className="font-display font-bold text-[120px] md:text-[160px] leading-none tracking-[-0.04em] text-ink/10 select-none">404</span>
      <h1 className="text-2xl font-semibold tracking-tight text-ink -mt-4">Página no encontrada</h1>
      <p className="text-sm text-muted max-w-sm mt-3 leading-relaxed">
        La ruta que buscas no existe o fue movida a otra sección de VoxReady.
      </p>
      <div className="flex items-center gap-2 mt-8">
        <Button variant="secondary" icon="arrowLeft" onClick={() => navigate(-1)}>
          Volver
        </Button>
        <Button onClick={() => navigate(user ? homeFor(user.role) : '/login')}>Ir al inicio</Button>
      </div>
    </div>
  );
}
