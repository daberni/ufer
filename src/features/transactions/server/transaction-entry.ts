export type Entry = {
  reference: string;
  date: string;
  amount: number;
  currency: string;
  counterparty: string;
  description: string;
  transfer?: boolean;
};

export type CategorizedEntry = Entry & {
  categoryId: string | null;
};
