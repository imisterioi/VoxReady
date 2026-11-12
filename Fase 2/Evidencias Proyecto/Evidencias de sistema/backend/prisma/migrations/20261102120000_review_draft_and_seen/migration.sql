-- Revisión humana de informes: borrador pendiente y aviso al vocero.
--
-- Cambio ADITIVO: solo añade dos columnas a Session. No modifica ni borra ningún dato existente.
--  - reviewDraft:  cambios que el revisor guarda SIN publicar. Es privado: el vocero sigue viendo
--                  exclusivamente el informe original de la IA hasta que la revisión se envía.
--  - reviewSeenAt: marca de lectura de la revisión publicada (campanita del vocero). NULL = no leída.
--    Las revisiones ya publicadas (Session.review) quedan con NULL: se consideran no leídas.

ALTER TABLE "Session" ADD COLUMN "reviewDraft" JSONB;
ALTER TABLE "Session" ADD COLUMN "reviewSeenAt" TIMESTAMP(3);
