import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
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

function App() {
  return (
    <BrowserRouter>
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

        {/* Rutas del Admin */}
          <Route path="admin" element={<AdminHome />} />

        {/* Rutas del Maestro */}
          <Route path="maestro" element={<MaestroHome />} />


        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;