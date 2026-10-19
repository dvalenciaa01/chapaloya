-- ==========================================================================
-- Reservalope · Migración 8 · Historial oculto para administradores
-- --------------------------------------------------------------------------
-- El módulo Historial de actividad deja de venir activado: ningún
-- administrador lo ve hasta que el superadministrador se lo habilite en
-- Usuarios y accesos → Permisos.
-- ==========================================================================

alter table public.profiles alter column grants set default
  '{"sales":true,"customers":true,"reports":true,"settings":true,"audit":false}';

update public.profiles
   set grants = jsonb_set(coalesce(grants, '{}'), '{audit}', 'false')
 where role = 'ADMIN';
