import common from "./common.json";
import shell from "./shell.json";
import account from "./account.json";
import legal from "./legal.json";
import overview from "./overview.json";
import reports from "./reports.json";
import accounts from "./accounts.json";
import transactions from "./transactions.json";
import categorization from "./categorization.json";
import banking from "./banking.json";
import imports from "./imports.json";
import securities from "./securities.json";

/** One namespace per feature file, so parallel changes rarely touch the same catalog file. */
export const de = {
  common,
  shell,
  account,
  legal,
  overview,
  reports,
  accounts,
  transactions,
  categorization,
  banking,
  imports,
  securities
};
