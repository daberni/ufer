import common from "./common.json";
import shell from "./shell.json";
import account from "./account.json";
import legal from "./legal.json";
import overview from "./overview.json";
import reports from "./reports.json";
import accounts from "./accounts.json";

/** One namespace per feature file, so parallel changes rarely touch the same catalog file. */
export const en = {
  common,
  shell,
  account,
  legal,
  overview,
  reports,
  accounts
};
