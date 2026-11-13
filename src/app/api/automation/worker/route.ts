import { NextResponse } from "next/server";
import { z } from "zod";
import {
  validWorkerAuthorization,
  runHostedWorker,
  workerDiagnostic,
} from "@/domains/automation/worker";
import { readBody } from "@/lib/http";
import { AppError, errorResponse } from "@/lib/errors";
export const maxDuration = 60;
export async function POST(request: Request) {
  try {
    if (!validWorkerAuthorization(request.headers.get("authorization")))
      throw new AppError(
        "WORKER_UNAUTHORIZED",
        "Background runner authorization is required.",
        401,
      );
    const input = z
      .object({ mode: z.enum(["run", "diagnostic"]).default("diagnostic") })
      .strict()
      .parse(await readBody(request));
    return NextResponse.json(
      input.mode === "diagnostic"
        ? await workerDiagnostic()
        : await runHostedWorker(),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
