/** Optional details a bank provider delivered with a transaction; each field is absent when the bank did not send it or sent it malformed. */
export type ProviderDetails = {
  valueDate?: string;
  transactionDate?: string;
  bankTransactionCode?: string;
  bankTransactionSubCode?: string;
  bankTransactionDescription?: string;
  merchantCategoryCode?: string;
  exchangeRate?: string;
  exchangeRateUnitCurrency?: string;
  exchangeRateType?: string;
  /** Signed like the entry amount, in minor units of instructedCurrency. */
  instructedAmount?: number;
  instructedCurrency?: string;
  balanceAfter?: number;
  balanceAfterCurrency?: string;
  referenceNumber?: string;
  counterpartyIban?: string;
  counterpartyAccountId?: string;
  counterpartyAccountScheme?: string;
  counterpartyBic?: string;
  /** The provider transaction as JSON text. */
  payload?: string;
};

export type Entry = {
  reference: string;
  date: string;
  amount: number;
  currency: string;
  counterparty: string;
  description: string;
  transfer?: boolean;
  provider?: ProviderDetails;
};

export type CategorizedEntry = Entry & {
  categoryId: string | null;
};
