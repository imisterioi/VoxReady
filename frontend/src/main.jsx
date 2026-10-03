import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { DEMO_MODE } from './lib/api'
import { installDemoServer } from './demo/server'

// Versión de demostración: las llamadas a /api/* se responden en el navegador
if (DEMO_MODE) installDemoServer()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
