import { toFailure, type Failure } from "./api";

export type ActionResult<T> = {
  ok: true;
  value: T;
} | {
  ok: false;
  failure: Failure;
};

/** Waits for an action, such as a mutation, and turns its failure into a message for the place where the action was started. */
export async function settle<T>(action: Promise<T>): Promise<ActionResult<T>> {
  try {
    return {
      ok: true,
      value: await action
    };
  } catch (error) {
    return {
      ok: false,
      failure: toFailure(error)
    };
  }
}
