export type Connection = {
  id: string;
  bank_name: string;
  bank_country: string;
  status: string;
  valid_until: string | null;
  error: string | null;
};

export type ConnectionRemoval = {
  retainedAccounts: number;
  /** Names of kept accounts that stayed active because their balance was not 0. */
  notArchived: string[];
};

export type SyncRun = {
  id: string;
  started_at: string;
  status: string;
  inserted_count: number;
  /** Transactions traceable to the run; zero for runs recorded before syncs stamped their rows. */
  linked_count: number;
  error: string | null;
};

/** Banking settings of this deployment; constant for the lifetime of a server process. */
export type BankingConfiguration = {
  environment: "SANDBOX" | "PRODUCTION";
  configured: boolean;
};

export type Bank = {
  name: string;
  country: string;
  beta?: boolean;
};
