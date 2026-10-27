import "server-only";
import { AppError } from "@/lib/errors";
// No live write adapter exists until official request/transition contracts are verified.
export function requireVerifiedWriteAdapter(): never {
  throw new AppError(
    "WRITE_CONTRACT_UNVERIFIED",
    "External execution is disabled. Verify the official request schema and permitted state transitions, then obtain explicit authorization for a single live write.",
    503,
  );
}
