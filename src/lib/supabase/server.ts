import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { AppError } from "@/lib/errors";
export function authConfigured() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}
export async function supabaseServer() {
  if (!authConfigured())
    throw new AppError(
      "SETUP_REQUIRED",
      "Configure Supabase to enable secure access.",
      503,
    );
  const jar = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => jar.getAll(),
        setAll(values) {
          try {
            values.forEach(({ name, value, options }) =>
              jar.set(name, value, {
                ...options,
                httpOnly: true,
                sameSite: "lax",
                secure: process.env.NODE_ENV === "production",
              }),
            );
          } catch {
            /* Server Components cannot write cookies; route handlers refresh them. */
          }
        },
      },
    },
  );
}
