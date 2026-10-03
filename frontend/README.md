# VoxReady — versión de demostración (solo frontend)

Esta copia del frontend está preparada para publicarse en Vercel y mostrarse a clientes:
se recorre completa **sin backend ni base de datos**. El proyecto real, con backend,
está en `Fase 2/Evidencias Proyecto/Evidencias de sistema/`.

## Cómo funciona el modo demostración

- `src/demo/server.js` intercepta las llamadas a `/api/*` y responde igual que el backend
  real (mismas rutas, permisos y formato).
- `src/demo/db.js` guarda los datos en el `localStorage` del navegador. La primera visita
  siembra organizaciones, usuarios, escenarios, patrones y prácticas con informes.
  Lo que se crea en la demo (temas, usuarios, prácticas) queda solo en ese navegador.
  El enlace **Restablecer datos** del login vuelve a los datos de ejemplo.
- `src/demo/interviewer.js` y `src/demo/evaluator.js` reemplazan a la IA: el entrevistador
  usa plantillas según el escenario y el evaluador aplica las mismas reglas de voz y
  expresión del backend, más reglas simples para coherencia y empatía.
- Las grabaciones de video solo se pueden ver en la misma pestaña donde se hizo la práctica.

Perfiles de demostración (contraseña `demo1234`): `vocero@demo.com`, `admin@demo.com`,
`marta@voxready.io` y `sofia@voxready.io`.

Para volver a usar el backend real, crea `frontend/.env` con:

```
VITE_DEMO_MODE=false
VITE_API_URL=http://localhost:3000
```

## Versión antigua / versión nueva

`public/version-antigua.html` es el wireframe original del proyecto. El switch flotante
(abajo a la izquierda) cambia entre ambas versiones y abre la pantalla equivalente con el
mismo rol (`src/demo/versions.js` tiene la tabla de equivalencias).

## Desarrollo

```
npm install
npm run dev
```

## Publicar en Vercel

1. Importa el repositorio en Vercel.
2. En **Root Directory** elige `frontend`.
3. Vercel detecta Vite: comando `npm run build` (o pnpm) y carpeta de salida `dist`.
   `vercel.json` redirige las rutas de la aplicación a `index.html`.
