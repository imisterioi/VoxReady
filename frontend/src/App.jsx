import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import MainLayout from './layouts/MainLayout';
import Login from './pages/Login';
import VoceroHome from './pages/VoceroHome';
import AdminHome from './pages/AdminHome';
import MaestroHome from './pages/MaestroHome';

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

          <Route path="vocero" element={<VoceroHome />} />
          <Route path="admin" element={<AdminHome />} />
          <Route path="maestro" element={<MaestroHome />} />


        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;