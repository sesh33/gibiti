import { NextResponse } from "next/server";
import { ZodError } from "zod";
export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export function errorResponse(error: unknown) {
  if (error instanceof AppError)
    return NextResponse.json(
      { error: { code: error.code, message: error.message } },
      { status: error.status, headers: { "Cache-Control": "no-store" } },
    );
  if (error instanceof ZodError)
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Check the submitted fields.",
        },
      },
      { status: 400 },
    );
  console.error(
    JSON.stringify({
      event: "request_failed",
      type: error instanceof Error ? error.name : "UnknownError",
    }),
  );
  return NextResponse.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "The request could not be completed.",
      },
    },
    { status: 500 },
  );
}
