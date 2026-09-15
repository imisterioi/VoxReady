import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import MainLayout from './layouts/MainLayout';
import Login from './pages/Login';
import VoceroHome from './pages/VoceroHome';
import AdminHome from './pages/AdminHome';
import MaestroHome from './pages/MaestroHome';
import ElegirEscenario from './pages/ElegirEscenario';
import CheckTecnico from './pages/CheckTecnico';
import SesionPractica from './pages/SesionPractica';
import Analizando from './pages/Analizando';
import InformeCoach from './pages/InformeCoach';
import MiProgreso from './pages/MiProgreso';
import PoliticaRetencion from './pages/PoliticaRetencion';
import EditorTema from './pages/EditorTema';
import EditorRubrica from './pages/EditorRubrica'; 
import ColaEtiquetado from './pages/ColaEtiquetado'; 
import Microleccion from './pages/Microleccion'; 
import NotFound from './pages/NotFound';

function App() {
  return (
    <BrowserRouter>
      <Toaster 
          position="bottom-right"
          toastOptions={{
            style: {
              background: 'var(--panel)',
              color: 'var(--ink)',
              border: '1px solid var(--line)',
              fontSize: '12px',
            },
          }}
        />
      <Routes>
        {/* Ruta del Login (No tiene el menú lateral, ocupa toda la pantalla) */}
        <Route path="/login" element={<Login />} />

        {/* Rutas de la aplicación (Sí tienen el menú lateral del MainLayout) */}
        <Route path="/" element={<MainLayout />}>
          {/* Si alguien entra a la raíz "/", lo mandamos directo al login */}
          <Route index element={<Navigate to="/login" replace />} />
          
        {/* Rutas del Vocero */}
          <Route path="vocero" element={<VoceroHome />} />
          <Route path="vocero/escenarios" element={<ElegirEscenario />} />
          <Route path="vocero/preparar" element={<CheckTecnico />} />
          <Route path="vocero/sesion" element={<SesionPractica />} />
          <Route path="vocero/analizando" element={<Analizando />} />
          <Route path="vocero/informe" element={<InformeCoach />} />
          <Route path="vocero/progreso" element={<MiProgreso />} />
          <Route path="vocero/leccion" element={<Microleccion />} />

        {/* Rutas del Admin */}
          <Route path="admin" element={<AdminHome />} />
          <Route path="admin/tema" element={<EditorTema />} /> {/* <-- 3. Ruta 1 */}
          <Route path="admin/retencion" element={<PoliticaRetencion />} /> {/* <-- 4. Ruta 2 */}

        {/* Rutas del Maestro */}
          <Route path="maestro" element={<MaestroHome />} />
          <Route path="maestro/rubrica" element={<EditorRubrica />} /> 
          <Route path="maestro/etiquetado" element={<ColaEtiquetado />} />

        {/* <-- 2. Ruta comodín 404 (atrapa cualquier URL inválida) */}
          <Route path="*" element={<NotFound />} />


        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;