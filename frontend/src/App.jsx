import { BrowserRouter, Routes, Route } from 'react-router-dom';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Ruta pública con prueba visual de Tailwind */}
        <Route path="/" element={
          <div className="min-h-screen bg-gray-200 flex flex-col items-center justify-center p-4">
            <div className="bg-white p-8 rounded-2xl shadow-2xl text-center max-w-md border-t-4 border-blue-500">
              <h1 className="text-3xl font-bold text-gray-800 mb-4">
                ¡Tailwind funciona! 🎉
              </h1>
              <p className="text-gray-600 mb-6">
                Si ves esta tarjeta blanca con sombra, fondo gris, y el botón de abajo cambia a azul oscuro al pasar el cursor, tu configuración está perfecta.
              </p>
              <button className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-6 rounded-lg transition-all duration-300 transform hover:scale-105">
                Probar Hover
              </button>
            </div>
          </div>
        } />
        
        {/* Rutas por rol */}
        <Route path="/vocero" element={<div className="p-10 text-xl font-semibold text-blue-600">Panel del Vocero</div>} />
        <Route path="/admin" element={<div className="p-10 text-xl font-semibold text-red-600">Panel del Administrador</div>} />
        <Route path="/maestro" element={<div className="p-10 text-xl font-semibold text-purple-600">Configuración Maestra</div>} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;