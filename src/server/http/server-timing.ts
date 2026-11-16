import { AsyncLocalStorage } from "node:async_hooks";
import { performance } from "node:perf_hooks";

type Phase = "auth" | "action";

type RequestTiming = {
  start: number;
  phases: Map<Phase, number>;
  databaseCalls: number;
  databaseTime: number;
};

const phaseDescriptions: Record<Phase, string> = {
  auth: "Session and membership",
  action: "Route action"
};

const currentRequest = new AsyncLocalStorage<RequestTiming>();

function elapsed(start: number) {
  return performance.now() - start;
}

function metric(name: string, duration: number, description: string) {
  return `${name};dur=${duration.toFixed(1)};desc="${description}"`;
}

function serverTiming(timing: RequestTiming) {
  const phases = [...timing.phases].map(([phase, duration]) => metric(phase, duration, phaseDescriptions[phase]));
  // Concurrent calls overlap, so their summed time can exceed the action's wall-clock time.
  const database = metric("db", timing.databaseTime, `${timing.databaseCalls} database calls, summed`);

  return [...phases, database, metric("total", elapsed(timing.start), "Total")].join(", ");
}

/** Runs one API request and reports its phases, database calls and total duration in a `Server-Timing` header. */
export async function measureRequest(handle: () => Promise<Response>) {
  const timing: RequestTiming = {
    start: performance.now(),
    phases: new Map(),
    databaseCalls: 0,
    databaseTime: 0
  };
  const response = await currentRequest.run(timing, handle);

  response.headers.set("Server-Timing", serverTiming(timing));

  return response;
}

export async function measurePhase<T>(phase: Phase, work: () => Promise<T>) {
  const start = performance.now();

  try {
    return await work();
  } finally {
    currentRequest.getStore()?.phases.set(phase, elapsed(start));
  }
}

/** Counts one database call toward the current request's timing; outside a measured request it only runs the call. */
export async function measureDatabaseCall<T>(call: () => Promise<T>) {
  const timing = currentRequest.getStore();
  const start = performance.now();

  try {
    return await call();
  } finally {
    if (timing) {
      timing.databaseCalls += 1;
      timing.databaseTime += elapsed(start);
    }
  }
}
