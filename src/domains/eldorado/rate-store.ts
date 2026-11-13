import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { AppError } from "@/lib/errors";
export type ProviderRateStore = {
  check(): Promise<void>;
  defer(until: number): Promise<void>;
};
export function eldoradoRateStore(): ProviderRateStore | undefined {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return undefined;
  return {
    async check() {
      const { data, error } = await supabaseAdmin()
        .from("integration_rate_state")
        .select("not_before")
        .eq("provider", "eldorado")
        .maybeSingle();
      if (error)
        throw new AppError(
          "RATE_GATE_UNAVAILABLE",
          "The shared provider cooldown could not be checked. No request was sent.",
          503,
        );
      const until =
        data?.not_before?.toLowerCase() === "infinity"
          ? Infinity
          : data
            ? Date.parse(data.not_before)
            : 0;
      if (until > Date.now()) {
        const seconds = Math.min(
          2147483647,
          Math.ceil((until - Date.now()) / 1000),
        );
        throw new AppError(
          "ELDORADO_RATE_LIMITED",
          `Eldorado requests are paused. Try again in ${seconds} seconds.`,
          429,
          seconds,
        );
      }
    },
    async defer(until) {
      const value =
        until - Date.now() > 2147483647 * 1000
          ? "infinity"
          : new Date(until).toISOString();
      const { error } = await supabaseAdmin().rpc("defer_eldorado_requests", {
        until_time: value,
      });
      if (error)
        throw new AppError(
          "RATE_GATE_UNAVAILABLE",
          "The provider cooldown could not be recorded.",
          503,
        );
    },
  };
}
