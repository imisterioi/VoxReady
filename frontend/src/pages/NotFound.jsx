import { useNavigate } from 'react-router-dom';
import I from '../data/dictionary';

export default function NotFound() {
  const d = I.es;
  const navigate = useNavigate();

  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh] text-center p-6 animate-fade-in">
      
      <div className="w-16 h-16 rounded-2xl bg-[var(--accentsoft)] border border-[var(--accent)] flex items-center justify-center text-2xl font-bold text-[var(--accent)] mb-4 shadow-sm">
        404
      </div>
      
      <h2 className="text-2xl font-bold text-[var(--ink)] mb-2">
        Página no encontrada
      </h2>
      
      <p className="text-sm text-[var(--muted)] max-w-md mb-6 leading-relaxed">
        Lo sentimos, la ruta que buscas no existe o fue movida a otra sección de VoxReady.
      </p>
      
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate(-1)}
          className="border border-[var(--line2)] bg-[var(--panel)] px-4 py-2 rounded-md text-xs font-semibold text-[var(--ink)] hover:bg-[var(--soft)] transition-colors"
        >
          ← Volver atrás
        </button>
        <button
          onClick={() => navigate('/vocero')}
          className="border border-[var(--accent2)] bg-[var(--accent2)] px-5 py-2 rounded-md text-xs font-semibold text-white hover:brightness-105 transition-all"
        >
          Ir al Inicio
        </button>
      </div>

    </div>
  );
}