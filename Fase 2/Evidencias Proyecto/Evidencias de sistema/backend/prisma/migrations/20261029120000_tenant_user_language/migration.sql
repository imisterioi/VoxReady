-- Idioma por defecto de la organización y preferencia individual del usuario.
--
-- Cambio ADITIVO: no se modifica ni se elimina ningún dato existente.
--  - Tenant.defaultLanguage: NOT NULL con DEFAULT 'es', así las organizaciones actuales quedan
--    en español sin necesidad de rellenar nada.
--  - User.language: NULL = sin preferencia individual (hereda el idioma de su organización).
--    Los usuarios actuales quedan en NULL y siguen funcionando con el idioma de su organización.

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN "defaultLanguage" TEXT NOT NULL DEFAULT 'es';

-- AlterTable
ALTER TABLE "User" ADD COLUMN "language" TEXT;
