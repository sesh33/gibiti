import "server-only";
import { createClient } from "@supabase/supabase-js";
import { AppError } from "@/lib/errors";
// Never import this module into a Client Component. The key is intentionally not NEXT_PUBLIC_.
export function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
    key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    throw new AppError(
      "SETUP_REQUIRED",
      "The server-side Supabase service binding is missing.",
      503,
    );
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
