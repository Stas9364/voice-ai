import { createClient } from "@supabase/supabase-js";

function getEnv(name: string): string {
  const value = process.env[name];
  if (!value?.trim()) {
    throw new Error(`Missing ${name} environment variable`);
  }
  return value;
}

/** Supabase JWT payload includes `role`: service_role | anon | authenticated */
function getSupabaseJwtRole(key: string): string | undefined {
  try {
    const parts = key.split(".");
    if (parts.length < 2) return undefined;
    const json = Buffer.from(parts[1], "base64url").toString("utf8");
    const payload = JSON.parse(json) as { role?: string };
    return typeof payload.role === "string" ? payload.role : undefined;
  } catch {
    return undefined;
  }
}

export function getSupabaseServerClient() {
  const url = getEnv("SUPABASE_URL");
  const serviceRoleKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");

  const role = getSupabaseJwtRole(serviceRoleKey);
  if (role === "anon" || role === "authenticated") {
    throw new Error(
      `Invalid SUPABASE_SERVICE_ROLE_KEY: JWT role is "${role}", expected "service_role". ` +
        `In Supabase Dashboard → Settings → API copy the "service_role" secret (not the anon/public key). ` +
        `The service role bypasses Row Level Security; anon key causes RLS errors on insert.`
    );
  }

  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
