import { createHash, timingSafeEqual } from "node:crypto";

export function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function constantTimeEqual(a: string, b: string) {
  const left = createHash("sha256").update(a).digest();
  const right = createHash("sha256").update(b).digest();

  return timingSafeEqual(left, right);
}
