-- Idioma de los escenarios y de cada sesión de práctica.
--
-- Cambio ADITIVO: no se modifica ni se elimina ningún dato existente.
--  - Theme.language: NOT NULL con DEFAULT 'es'. Los escenarios actuales (generales y de cada
--    organización) quedan como contenido en español; los escenarios generales en inglés se
--    registran como filas nuevas del catálogo inglés.
--  - Session.language: NULL en las sesiones históricas (el idioma se resuelve con el vocero o su
--    organización). Las sesiones nuevas guardan el idioma con el que se iniciaron.

-- AlterTable
ALTER TABLE "Theme" ADD COLUMN "language" TEXT NOT NULL DEFAULT 'es';

-- AlterTable
ALTER TABLE "Session" ADD COLUMN "language" TEXT;
