import { randomBytes, randomUUID } from "node:crypto";
import { STATUS_CODES } from "node:http";
import { isSpanContextValid, trace } from "@opentelemetry/api";
import { NextResponse } from "next/server";
import { z } from "zod";
import { HttpError, ValidationError } from "@/lib/errors";
import type { ProblemDetails } from "@/lib/problem-details";

export function problemResponse(error: unknown, originalHeaders?: HeadersInit) {
  let status = 500;
  let detail = "The request could not be processed. Try again or use the trace ID when requesting support.";
  let errorType = error instanceof Error ? error.name : typeof error;

  if (error instanceof HttpError && error.status >= 400 && error.status <= 599) {
    status = error.status;
    detail = error.message;
    errorType = "HttpError";
  } else if (error instanceof ValidationError) {
    status = 422;
    detail = error.message;
    errorType = "ValidationError";
  } else if (error instanceof z.ZodError) {
    status = 400;
    detail = "Input is incomplete or invalid.";
  }

  const spanContext = trace.getActiveSpan()?.spanContext();
  const traceId = spanContext && isSpanContextValid(spanContext) ? spanContext.traceId : randomBytes(16).toString("hex");
  const problem: ProblemDetails = {
    type: "about:blank",
    title: STATUS_CODES[status] ?? "Request Failed",
    status,
    detail,
    instance: `urn:uuid:${randomUUID()}`,
    traceId
  };
  const diagnostic = {
    traceId,
    instance: problem.instance,
    status,
    errorType
  };

  // Messages, causes and request URLs can expose SQL parameters, credentials or financial data.
  if (status === 500) {
    console.error("API request failed.", diagnostic);
  } else {
    console.warn("API request rejected.", diagnostic);
  }

  const headers = new Headers(originalHeaders);

  headers.delete("Content-Length");
  headers.delete("Content-Encoding");
  headers.set("Content-Type", "application/problem+json");
  headers.set("Cache-Control", "no-store");
  headers.set("X-Trace-Id", traceId);

  return NextResponse.json(problem, {
    status,
    headers
  });
}
