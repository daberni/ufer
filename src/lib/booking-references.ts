// These prefixes are persisted in transactions.provider_reference; changing them requires a data migration.

/** Counterparts created on a manual account carry the source booking's id in this reference; unlinking removes them again. */
export const createdCounterpartPrefix = "transfer:";

/** Bookings entered in Ufer on a manual account (manual transactions, opening balances and adjustments) carry their own id in this reference. */
export const manualEntryPrefix = "manual:";

/** The mapped CSV import derives these references from row content or an export ID; a bank delivery adopts such rows under its own reference. */
export const mappedReferencePrefix = "csv:m:";
