import { lazy, Suspense } from 'react';
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
import Estilo from './pages/Estilo';
import EditorTema from './pages/EditorTema';
import EditorRubrica from './pages/EditorRubrica';
import ColaEtiquetado from './pages/ColaEtiquetado';
import Microleccion from './pages/Microleccion';
import NotFound from './pages/NotFound';
import Laboratorio from './pages/Laboratorio';
import Voceros from './pages/Voceros';
import Practicas from './pages/Practicas';
import SistemaHome from './pages/sistema/SistemaHome';
import Organizaciones from './pages/sistema/Organizaciones';
import Usuarios from './pages/sistema/Usuarios';
import DemoEntry from './pages/DemoEntry';
import VersionSwitch from './components/VersionSwitch';
import DemoNotice from './components/DemoNotice';
import { DEMO_MODE } from './lib/api';

// MediaPipe es pesado: se carga solo al entrar a la prueba
const MediaPipeTest = lazy(() => import('./pages/MediaPipeTest'));

function App() {
  return (
    <BrowserRouter>
      <Toaster
        position="bottom-right"
        toastOptions={{
          style: {
            background: 'rgb(var(--surface))',
            color: 'rgb(var(--ink))',
            border: '1px solid rgb(var(--line))',
            borderRadius: '12px',
            fontSize: '13px',
            boxShadow: '0 12px 32px -8px rgb(15 27 42 / 0.18)',
          },
          success: { iconTheme: { primary: 'rgb(var(--success))', secondary: 'rgb(var(--surface))' } },
        }}
      />
      {/* Demo: switch flotante entre la versión antigua (wireframe) y la nueva */}
      {DEMO_MODE && <VersionSwitch />}
      {DEMO_MODE && <DemoNotice />}
      <Routes>
        {/* Login: pantalla completa, sin navegación */}
        <Route path="/login" element={<Login />} />

        {/* Demo: entrada desde la versión antigua con el rol equivalente */}
        <Route path="/demo/entrar" element={<DemoEntry />} />

        {/* Rutas con la navegación principal */}
        <Route path="/" element={<MainLayout />}>
          <Route index element={<Navigate to="/login" replace />} />

          {/* Laboratorio: pruebas técnicas (backend + MediaPipe) */}
          <Route path="laboratorio" element={<Laboratorio />} />
          <Route
            path="mediapipe-test"
            element={
              <Suspense fallback={null}>
                <MediaPipeTest />
              </Suspense>
            }
          />

          {/* Vocero */}
          <Route path="vocero" element={<VoceroHome />} />
          <Route path="vocero/escenarios" element={<ElegirEscenario />} />
          <Route path="vocero/preparar" element={<CheckTecnico />} />
          <Route path="vocero/preparar-popup" element={<Navigate to="/vocero/preparar" replace />} />
          <Route path="vocero/sesion" element={<SesionPractica />} />
          <Route path="vocero/analizando" element={<Analizando />} />
          <Route path="vocero/informe" element={<InformeCoach />} />
          <Route path="vocero/progreso" element={<MiProgreso />} />
          <Route path="vocero/leccion" element={<Microleccion />} />
          <Route path="vocero/leccion/:id" element={<Microleccion />} />

          {/* Admin del cliente */}
          <Route path="admin" element={<AdminHome />} />
          <Route path="admin/voceros" element={<Voceros />} />
          <Route path="admin/practicas" element={<Practicas />} />
          <Route path="admin/informe" element={<InformeCoach audience="admin" />} />
          <Route path="admin/tema" element={<EditorTema />} />
          <Route path="admin/retencion" element={<PoliticaRetencion />} />
          <Route path="admin/estilo" element={<Estilo />} />

          {/* Configurador maestro */}
          <Route path="maestro" element={<MaestroHome />} />
          <Route path="maestro/rubrica" element={<EditorRubrica />} />
          <Route path="maestro/etiquetado" element={<ColaEtiquetado />} />
          <Route path="maestro/informe" element={<InformeCoach audience="master" />} />

          {/* Administrador del sistema */}
          <Route path="sistema" element={<SistemaHome />} />
          <Route path="sistema/organizaciones" element={<Organizaciones />} />
          <Route path="sistema/usuarios" element={<Usuarios />} />

          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
