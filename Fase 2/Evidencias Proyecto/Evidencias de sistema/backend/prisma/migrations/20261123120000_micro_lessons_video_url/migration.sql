-- Microlecciones: enlace de video externo (p. ej. YouTube).
--
-- Cambio ADITIVO y COMPATIBLE: se añade una columna NULLABLE a una tabla existente.
--  - Los registros existentes quedan con videoUrl = NULL y siguen reproduciendo su archivo
--    subido (videoFile) exactamente como hasta ahora: no hay que volver a subir nada.
--  - Cuando videoUrl tiene valor, es la fuente de reproducción (video externo). El archivo
--    subido, si existiera, se conserva en disco pero deja de usarse.
--  - No se modifica ni se elimina ningún dato existente y no se toca ninguna otra tabla.

ALTER TABLE "MicroLesson" ADD COLUMN "videoUrl" TEXT;
