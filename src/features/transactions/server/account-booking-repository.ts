import type { DatabaseTransaction } from "@/server/database/connection";
import { withRefusableTransaction, withTransaction } from "@/server/database/transaction";

/** Runs an account booking use case in one write transaction; account and booking reads and writes take the provided transaction. */
export async function withAccountBookingTransaction<Result>(work: (tx: DatabaseTransaction) => Promise<Result>) {
  return withTransaction(work);
}

/** Runs an account booking use case like `withAccountBookingTransaction`; a `refuse(result)` inside rolls it back and resolves to that result. */
export async function withRefusableAccountBookingTransaction<Result>(work: (tx: DatabaseTransaction) => Promise<Result>) {
  return withRefusableTransaction(work);
}

export { refuse } from "@/server/database/transaction";
