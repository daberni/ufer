import common from "./common.json";
import shell from "./shell.json";
import account from "./account.json";
import legal from "./legal.json";

/** One namespace per feature file, so parallel changes rarely touch the same catalog file. */
export const en = {
  common,
  shell,
  account,
  legal
};
