// Importar las librerías necesarias
const express = require('express');
const cors = require('cors');
require('dotenv').config();

// Inicializar la aplicación
const app = express();

// Configurar middlewares básicos
app.use(cors()); 
app.use(express.json()); // Permite que el servidor entienda datos en formato JSON

// Crear el primer endpoint de prueba (Health Check)
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'VoxReady API',
    mensaje: '¡El backend está vivo y funcionando!'
  });
});

// Definir el puerto y encender el servidor
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Servidor backend de VoxReady corriendo en http://localhost:${PORT}`);
});