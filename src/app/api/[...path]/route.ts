import { HttpError } from "@/lib/errors";
import { problemResponse } from "@/server/http/problem-response";

function notFound() {
  return problemResponse(new HttpError(404, "Endpoint not found."));
}

export { notFound as GET, notFound as POST, notFound as PUT, notFound as PATCH, notFound as DELETE };
