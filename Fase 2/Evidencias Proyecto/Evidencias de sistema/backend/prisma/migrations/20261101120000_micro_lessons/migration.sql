-- Microlecciones (formación de voceros).
--
-- Cambio ADITIVO: se crea una tabla NUEVA. No se modifica ninguna tabla existente y no se altera
-- ningún dato.
--  - language: idioma PROPIO de la lección ('es' | 'en'). No se infiere del título ni del contenido
--    y no se traduce automáticamente: cada catálogo muestra solo las lecciones de su idioma.
--  - areas: áreas de la rúbrica que refuerza (subconjunto de expression | voice | coherence |
--    empathy). No se crean áreas nuevas ni se toca la rúbrica.
--  - active: permite retirar la lección del catálogo sin borrarla.
--  - videoFile: nombre del archivo en uploads/lessons (NULL = todavía sin video).

CREATE TABLE "MicroLesson" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'es',
    "areas" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "videoFile" TEXT,
    "videoMime" TEXT,
    "videoBytes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "MicroLesson_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MicroLesson_language_active_idx" ON "MicroLesson"("language", "active");
