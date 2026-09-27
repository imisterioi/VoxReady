# Cómo actualizar y correr VoxReady

Instrucciones para pasar desde el commit **"Funcionalidad Añadir tema" (64c6e1c)** a la versión actual.

## 0. Requisitos

- Node.js LTS y PostgreSQL corriendo, con la base `voxready_db` que ya usabas.
- **Chrome o Edge.** La transcripción de voz solo funciona en estos navegadores; Edge tiene las voces más naturales.
- Una **API key de NVIDIA**: créala en <https://build.nvidia.com> → "Get API Key". Es gratis.
- Audífonos para la entrevista, para que el micrófono no capte la voz del entrevistador.

## 1. Traer los cambios

Si tienes cambios sin subir, haz commit o guárdalos antes.

```bash
git pull
```

> Tu `backend/.env` (con tu contraseña de PostgreSQL) **no se modifica**: nadie más lo sube.

## 2. Backend

Todos estos comandos se ejecutan en la carpeta `backend`.

```bash
npm install
```

Aplica las 3 migraciones nuevas de la base de datos:

```bash
npx prisma migrate deploy
```

Regenera el cliente de Prisma (obligatorio después de migrar):

```bash
npx prisma generate
```

Carga las cuentas de prueba y el escenario integral:

```bash
node prisma/seed.js
```

### Crear `backend/.env.local`

1. Copia `backend/.env.local.example` y llama a la copia `.env.local`.
2. Completa `NVIDIA_API_KEY` con tu key.
3. En `AUTH_SECRET` pon cualquier texto largo y aleatorio (por ejemplo, 40 caracteres cualquiera).
4. Deja el resto como viene.

> `.env.local` está en `.gitignore`: **nunca se sube a GitHub**. No pongas la key en `.env`, porque ese archivo sí se sube.

### Levantar el backend

```bash
node index.js
```

En la consola debes ver:

```
Servidor backend de VoxReady corriendo en http://localhost:3000
[IA] Entrevistador listo (...)
```

## 3. Frontend

En otra terminal, dentro de la carpeta `frontend`:

```bash
npm install
```

```bash
npm run dev
```

Abre <http://localhost:5173>.

## 4. Cuentas de prueba

La contraseña de todas es `demo1234`.

| Rol | Correo |
|---|---|
| Administrador del sistema | sofia@voxready.io |
| Configurador maestro | marta@voxready.io |
| Admin "Empresa Demo" | admin@demo.com |
| Voceros "Empresa Demo" | vocero@demo.com (Ana), diego@demo.com |
| Admin "Energía Andes" | lucia@andes.cl |
| Vocero "Energía Andes" | tomas@andes.cl |

Los 4 primeros también están como botones en el login.

## 5. Qué probar

| Rol | Dónde | Qué |
|---|---|---|
| Vocero | Escenarios → **Prueba integral** → Preparación | Ventana emergente con el escenario, luego cámara, micrófono, luz, calibración y consentimiento |
| Vocero | Entrevista | La IA pregunta en voz alta y repregunta según tu respuesta; se miden voz, cuerpo y contenido |
| Vocero | Informe / Mi progreso | Informe con IA, video, mensajes clave, líneas rojas, historial y gráfico |
| Vocero | Microlecciones | 6 lecciones con videos de YouTube |
| Admin cliente | Panel / Temas | Crear y editar escenarios, asignarlos a todos o a voceros específicos |
| Admin cliente | Voceros / Prácticas / Retención | Crear voceros, ver sus informes y videos, configurar la retención |
| Configurador maestro | Rúbrica | Patrones: pesos, criterios, rangos, versiones, excepciones por escenario y por vocero |
| Configurador maestro | Etiquetado | Revisión experta de prácticas reales |
| Sistema | Resumen / Organizaciones / Usuarios | Estado del sistema, crear organizaciones y usuarios |

## 6. Problemas comunes

| Problema | Solución |
|---|---|
| "Correo o contraseña incorrectos" con las cuentas demo | Falta correr `node prisma/seed.js` |
| El backend se cae al iniciar con errores de Prisma | Corre `npx prisma migrate deploy` y luego `npx prisma generate` |
| "La IA no está configurada" | Falta `backend/.env.local` con `NVIDIA_API_KEY`; reinicia el backend |
| "El entrevistador IA no respondió" | El plan gratuito de NVIDIA a veces se satura: espera un minuto y reintenta |
| "Empresa Demo" aparece dos veces | Viene de un seed antiguo. Si no te importan los datos locales: `npx prisma migrate reset` y luego `node prisma/seed.js` (**borra toda la base local**) |
| No se transcribe la voz | Usa Chrome o Edge, y permite el micrófono |
| `git add .` falla por `backend/node_modules` | Agrega los archivos por nombre (`git add backend/index.js ...`) |

## 7. Qué NO subir a GitHub

- `backend/.env` (contraseña de PostgreSQL)
- `backend/.env.local` (API key de NVIDIA)
- `backend/uploads/` (grabaciones de las sesiones; ya está en `.gitignore`)
- `node_modules`

## Docker

Todavía no se usa. El PC donde se hizo esta versión no tiene Docker instalado, así que la configuración con `docker-compose` quedó pendiente. Por ahora se corre de forma local como se explica arriba.
