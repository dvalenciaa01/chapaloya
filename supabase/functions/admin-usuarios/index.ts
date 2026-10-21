// ==========================================================================
// Edge Function · admin-usuarios
// --------------------------------------------------------------------------
// Crear cuentas, restablecer contraseñas y editar usuarios. Solo aquí se usa
// la secret key, nunca en el navegador.
//   - SUPERADMIN: cualquier usuario.
//   - ADMIN: solo el personal (STAFF) de su propio negocio.
// Acciones (POST JSON con el token del usuario en Authorization):
//   { action: "create", name, email, role, tenant_id, barber_id }
//   { action: "reset_password", user_id }
//   { action: "update", user_id, name?, email?, role?, tenant_id?, barber_id?, active?, grants? }
// Responde { ok: true, user, temp_password? } o { error }.
//
// Contraseña temporal (A3): al crear o restablecer se llama a la RPC
// perfil_clave_temporal, que marca must_change_password y guarda la huella de
// la clave; la base solo deja quitar la marca cuando la clave cambió.
// ==========================================================================
import { createClient } from 'npm:@supabase/supabase-js@2.117.2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const ROLES = ['SUPERADMIN', 'ADMIN', 'STAFF'];
const GRANT_KEYS = ['sales', 'customers', 'reports', 'settings', 'audit'];
const DEFAULT_GRANTS = { sales: true, customers: true, reports: true, settings: true, audit: false };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

// Contraseña temporal legible: 4 + 4 + 2 caracteres y un dígito garantizado (igual que la demo)
function tempPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const a = new Uint8Array(10);
  crypto.getRandomValues(a);
  const p = Array.from(a, (b) => chars[b % chars.length]).join('');
  return p.slice(0, 4) + '-' + p.slice(4, 8) + p.slice(8) + '7';
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'Método no permitido.' });

  const url = Deno.env.get('SUPABASE_URL')!;
  const secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_KEY');
  if (!url || !secret) return json(500, { error: 'Falta configurar la clave del servidor (SERVICE_KEY).' });
  const sb = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });

  try {
    // ---------- ¿Quién llama? ----------
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (!token) throw new HttpError(401, 'Sesión no válida.');
    const { data: who, error: whoErr } = await sb.auth.getUser(token);
    if (whoErr || !who?.user) throw new HttpError(401, 'Sesión no válida. Vuelve a ingresar.');
    const { data: me } = await sb.from('profiles').select('*').eq('id', who.user.id).maybeSingle();
    if (!me || !me.active) throw new HttpError(403, 'Tu usuario no tiene acceso.');
    if (me.must_change_password) throw new HttpError(403, 'Primero cambia tu contraseña temporal.');
    if (me.role !== 'SUPERADMIN') {
      const { data: t } = await sb.from('tenants').select('status').eq('id', me.tenant_id).maybeSingle();
      if (!t || t.status !== 'ACTIVE') throw new HttpError(403, 'Tu negocio está suspendido.');
    }
    if (me.role === 'STAFF') throw new HttpError(403, 'No tienes permiso para administrar usuarios.');
    const isSuper = me.role === 'SUPERADMIN';

    const body = await req.json().catch(() => ({}));
    const action = String(body.action || '');

    // Un ADMIN solo administra al personal de su negocio
    const canManage = (target: { role: string; tenant_id: string | null; id: string }) =>
      isSuper || (target.role === 'STAFF' && target.tenant_id === me.tenant_id && target.id !== me.id);

    const loadTarget = async (id: string) => {
      const { data } = await sb.from('profiles').select('*').eq('id', id).maybeSingle();
      if (!data) throw new HttpError(404, 'El usuario no existe.');
      if (!canManage(data)) throw new HttpError(403, 'No puedes administrar a este usuario.');
      return data;
    };

    const checkTenantAndBarber = async (tenantId: string | null, barberId: string | null) => {
      if (tenantId) {
        const { data: t } = await sb.from('tenants').select('id').eq('id', tenantId).maybeSingle();
        if (!t) throw new HttpError(400, 'Selecciona un negocio válido.');
      }
      if (barberId) {
        const { data: b } = await sb.from('barbers').select('id').eq('id', barberId).eq('tenant_id', tenantId).maybeSingle();
        if (!b) throw new HttpError(400, 'El profesional no pertenece a ese negocio.');
      }
    };

    const log = (action_: string, detail: string, tenantId: string | null) =>
      sb.from('audit_log').insert({
        tenant_id: tenantId, user_id: me.id, user_name: me.name || me.email, role: me.role, action: action_, detail,
      });

    // ---------- Crear ----------
    if (action === 'create') {
      const name = String(body.name || '').trim();
      const email = String(body.email || '').trim().toLowerCase();
      let role = String(body.role || 'STAFF');
      let tenantId: string | null = body.tenant_id || null;
      let barberId: string | null = body.barber_id || null;
      if (!isSuper) { role = 'STAFF'; tenantId = me.tenant_id; }
      if (!ROLES.includes(role)) throw new HttpError(400, 'Rol no válido.');
      if (!name) throw new HttpError(400, 'Escribe el nombre.');
      if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Escribe un correo válido.');
      if (role === 'SUPERADMIN') tenantId = null;
      else if (!tenantId) throw new HttpError(400, 'Selecciona un negocio.');
      if (role !== 'STAFF') barberId = null;
      await checkTenantAndBarber(tenantId, barberId);

      const temp = tempPassword();
      const { data: created, error: cErr } = await sb.auth.admin.createUser({
        email, password: temp, email_confirm: true, user_metadata: { name },
      });
      if (cErr || !created?.user) {
        const msg = /already|registered|exists/i.test(cErr?.message || '') ? 'Ya existe un usuario con ese correo.' : (cErr?.message || 'No se pudo crear el usuario.');
        throw new HttpError(400, msg);
      }
      const profile = {
        id: created.user.id, email, name, role, tenant_id: tenantId, barber_id: barberId,
        grants: DEFAULT_GRANTS, active: true, must_change_password: true,
      };
      const { data: prof0, error: pErr } = await sb.from('profiles').insert(profile).select().single();
      if (pErr) {
        await sb.auth.admin.deleteUser(created.user.id);
        throw new HttpError(400, 'No se pudo crear el perfil: ' + pErr.message);
      }
      // Huella de la clave temporal (el trigger también la guarda; esto lo asegura)
      const { error: hErr } = await sb.rpc('perfil_clave_temporal', { p_user_id: created.user.id });
      if (hErr) {
        await sb.from('profiles').delete().eq('id', created.user.id);
        await sb.auth.admin.deleteUser(created.user.id);
        throw new HttpError(400, 'No se pudo crear el usuario: ' + hErr.message);
      }
      const prof = prof0;
      await log('Creó un usuario', name + ' (' + email + ') · ' + role, tenantId);
      return json(200, { ok: true, user: prof, temp_password: temp });
    }

    // ---------- Restablecer contraseña ----------
    if (action === 'reset_password') {
      const target = await loadTarget(String(body.user_id || ''));
      if (target.id === me.id) throw new HttpError(400, 'Para tu propia cuenta usa "Cambiar contraseña".');
      const temp = tempPassword();
      const { error } = await sb.auth.admin.updateUserById(target.id, { password: temp });
      if (error) throw new HttpError(400, 'No se pudo restablecer: ' + error.message);
      const { error: hErr } = await sb.rpc('perfil_clave_temporal', { p_user_id: target.id });
      if (hErr) throw new HttpError(400, 'No se pudo restablecer: ' + hErr.message);
      const { data: prof } = await sb.from('profiles').select('*').eq('id', target.id).single();
      await log('Restableció una contraseña', target.name + ' (' + target.email + ')', target.tenant_id);
      return json(200, { ok: true, user: prof, temp_password: temp });
    }

    // ---------- Editar ----------
    if (action === 'update') {
      const target = await loadTarget(String(body.user_id || ''));
      const patch: Record<string, unknown> = {};
      if (body.name !== undefined) {
        const n = String(body.name).trim();
        if (!n) throw new HttpError(400, 'Escribe el nombre.');
        patch.name = n;
      }
      if (body.email !== undefined) {
        const e = String(body.email).trim().toLowerCase();
        if (!EMAIL_RE.test(e)) throw new HttpError(400, 'Escribe un correo válido.');
        if (e !== target.email) patch.email = e;
      }
      let role = target.role;
      let tenantId = target.tenant_id;
      if (isSuper && target.id !== me.id) {
        if (body.role !== undefined) {
          if (!ROLES.includes(body.role)) throw new HttpError(400, 'Rol no válido.');
          role = body.role;
        }
        if (body.tenant_id !== undefined) tenantId = body.tenant_id || null;
        if (role === 'SUPERADMIN') tenantId = null;
        else if (!tenantId) throw new HttpError(400, 'Selecciona un negocio.');
        patch.role = role;
        patch.tenant_id = tenantId;
        if (body.grants !== undefined && role === 'ADMIN') {
          const g: Record<string, boolean> = {};
          GRANT_KEYS.forEach((k) => { g[k] = !!body.grants[k]; });
          patch.grants = g;
        }
      }
      if (body.barber_id !== undefined || role !== 'STAFF') {
        const b = role === 'STAFF' ? (body.barber_id !== undefined ? (body.barber_id || null) : target.barber_id) : null;
        await checkTenantAndBarber(tenantId, b);
        patch.barber_id = b;
      }
      if (body.active !== undefined && target.id !== me.id) {
        const active = !!body.active;
        if (!active && target.role === 'SUPERADMIN') {
          const { count } = await sb.from('profiles').select('id', { count: 'exact', head: true })
            .eq('role', 'SUPERADMIN').eq('active', true).neq('id', target.id);
          if (!count) throw new HttpError(400, 'Debe quedar al menos un superadministrador activo.');
        }
        patch.active = active;
      }

      // Primero el perfil y luego Supabase Auth; si Auth falla, el perfil vuelve
      // a como estaba, para que el correo y el estado nunca queden distintos.
      const { data: prof, error: uErr } = await sb.from('profiles').update(patch).eq('id', target.id).select().single();
      if (uErr) throw new HttpError(400, 'No se pudo guardar el usuario: ' + uErr.message);
      if (patch.email || patch.active !== undefined) {
        const authPatch: Record<string, unknown> = {};
        if (patch.email) { authPatch.email = patch.email; authPatch.email_confirm = true; }
        // Desactivar también bloquea la sesión en Supabase Auth
        if (patch.active !== undefined) authPatch.ban_duration = patch.active ? 'none' : '876000h';
        const { error } = await sb.auth.admin.updateUserById(target.id, authPatch);
        if (error) {
          const back: Record<string, unknown> = {};
          Object.keys(patch).forEach((k) => { back[k] = (target as Record<string, unknown>)[k]; });
          const { error: rbErr } = await sb.from('profiles').update(back).eq('id', target.id);
          if (rbErr) console.error('No se pudo revertir el perfil', target.id, rbErr.message);
          const msg = /already|registered|exists/i.test(error.message) ? 'Ya existe un usuario con ese correo.' : 'No se pudo guardar el usuario: ' + error.message;
          throw new HttpError(400, msg);
        }
      }
      return json(200, { ok: true, user: prof });
    }

    throw new HttpError(400, 'Acción no válida.');
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    return json(status, { error: e instanceof Error ? e.message : 'Error inesperado.' });
  }
});
