// Supabase Edge Function: admin-users
// Handles privileged Super Administrator actions (inviting staff, updating roles, toggling active status)
// Uses SUPABASE_SERVICE_ROLE_KEY strictly on the server after verifying caller JWT + super_admin role.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const ALLOWED_ROLES = new Set(['super_admin', 'content_admin', 'editor']);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return new Response(JSON.stringify({ error: 'Supabase environment variables not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing Authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Verify caller identity using their JWT
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData?.user) {
      return new Response(JSON.stringify({ error: 'Invalid or expired session' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const serviceClient = createClient(supabaseUrl, serviceRoleKey);

    // Check caller is an active super_admin in profiles
    const { data: callerProfile, error: profileErr } = await serviceClient
      .from('profiles')
      .select('id, email, role, is_active')
      .eq('id', userData.user.id)
      .single();

    if (profileErr || !callerProfile || !callerProfile.is_active || callerProfile.role !== 'super_admin') {
      return new Response(JSON.stringify({ error: 'Forbidden: Super Administrator role required' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const payload = await req.json();
    const action = String(payload?.action || '');

    if (action === 'invite') {
      const email = String(payload?.email || '').trim().toLowerCase();
      const fullName = String(payload?.full_name || '').trim();
      const role = String(payload?.role || 'editor');

      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return new Response(JSON.stringify({ error: 'Valid email is required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (!ALLOWED_ROLES.has(role)) {
        return new Response(JSON.stringify({ error: 'Invalid role specified' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const { data: inviteData, error: inviteError } = await serviceClient.auth.admin.inviteUserByEmail(email, {
        data: { full_name: fullName || email.split('@')[0] },
      });

      if (inviteError) {
        return new Response(JSON.stringify({ error: inviteError.message }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (inviteData?.user?.id) {
        await serviceClient.from('profiles').upsert({
          id: inviteData.user.id,
          email,
          full_name: fullName || email.split('@')[0],
          role,
          is_active: true,
        });
      }

      await serviceClient.from('activity_logs').insert({
        actor_id: callerProfile.id,
        actor_email: callerProfile.email,
        action: 'admin.invited_user',
        entity_type: 'profile',
        entity_id: inviteData?.user?.id || email,
        summary: `Invited ${email} as ${role}`,
      });

      return new Response(JSON.stringify({ ok: true, user: inviteData.user }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'update_member') {
      const targetId = String(payload?.user_id || '');
      const role = payload?.role ? String(payload.role) : undefined;
      const isActive = typeof payload?.is_active === 'boolean' ? payload.is_active : undefined;

      if (!targetId) {
        return new Response(JSON.stringify({ error: 'user_id is required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (targetId === callerProfile.id && (isActive === false || (role && role !== 'super_admin'))) {
        return new Response(JSON.stringify({ error: 'You cannot demote or deactivate your own Super Administrator account.' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (role && !ALLOWED_ROLES.has(role)) {
        return new Response(JSON.stringify({ error: 'Invalid role specified' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const updates: Record<string, unknown> = {};
      if (role) updates.role = role;
      if (isActive !== undefined) updates.is_active = isActive;

      const { data: updated, error: updateErr } = await serviceClient
        .from('profiles')
        .update(updates)
        .eq('id', targetId)
        .select()
        .single();

      if (updateErr) {
        return new Response(JSON.stringify({ error: updateErr.message }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      await serviceClient.from('activity_logs').insert({
        actor_id: callerProfile.id,
        actor_email: callerProfile.email,
        action: 'admin.updated_member',
        entity_type: 'profile',
        entity_id: targetId,
        summary: `Updated ${updated.email} (${JSON.stringify(updates)})`,
      });

      return new Response(JSON.stringify({ ok: true, profile: updated }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Unsupported action' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : 'Server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
