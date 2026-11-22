import { TransactionRollbackError } from "drizzle-orm";
import { database, type DatabaseTransaction } from "./connection";

/** Runs `work` in one write transaction on the shared application connection; a thrown error rolls it back. */
export async function withTransaction<Result>(work: (tx: DatabaseTransaction) => Promise<Result>) {
  const db = await database();

  return db.transaction(work);
}

class Refused<Result> extends TransactionRollbackError {
  constructor(readonly result: Result) {
    super();
  }
}

/** Rolls back the surrounding `withRefusableTransaction` and makes it resolve to `result`. */
export function refuse<Result>(result: Result): never {
  throw new Refused(result);
}

/** Runs `work` like `withTransaction`; a `refuse(result)` inside rolls it back and resolves to that result instead of throwing. */
export async function withRefusableTransaction<Result>(work: (tx: DatabaseTransaction) => Promise<Result>): Promise<Result> {
  try {
    return await withTransaction(work);
  } catch (error) {
    if (error instanceof Refused) {
      return error.result as Result;
    }

    throw error;
  }
}
