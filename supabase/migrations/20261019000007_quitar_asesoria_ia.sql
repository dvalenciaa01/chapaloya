-- ==========================================================================
-- Reservalope · Migración 7 · Se retira la asesoría IA
-- --------------------------------------------------------------------------
-- La asesoría IA ya no forma parte del producto. Se borra su tabla (con sus
-- permisos) y el módulo "ai" de los accesos que el superadmin otorga.
-- OJO: borra para siempre las asesorías guardadas en ai_consultations.
-- ==========================================================================

drop table if exists public.ai_consultations;

alter table public.profiles alter column grants set default
  '{"sales":true,"customers":true,"reports":true,"settings":true,"audit":false}';

update public.profiles set grants = grants - 'ai' where grants ? 'ai';
