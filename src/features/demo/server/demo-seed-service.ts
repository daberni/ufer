import type { Temporal } from "temporal-polyfill";
import { sameCategoryName } from "@/lib/category-name";
import type { Rule } from "@/lib/rules";
import { today } from "@/lib/time";
import { environment } from "@/features/banking/server/environment";
import { categorizeEntries } from "@/features/transactions/server/categorize-entries";
import { demoCategories, demoRules } from "./demo-catalog";
import { buildDemoDataset } from "./demo-dataset";
import { countDemoRows, listForeignCategories, replaceDemoRows, type DemoSeedTarget } from "./demo-seed-repository";

/** An expected refusal of the guard, reported to the operator without a stack trace. */
export class DemoSeedRefusal extends Error {}

export type DemoSeedOptions = {
  confirmed: boolean;
  runDate?: Temporal.PlainDate;
};

/**
 * The demo replaces only its own rows, but it must never mix with real records:
 * the configured banking environment and every stored account or connection must be SANDBOX, and manual or CSV accounts the seed did not create must not hold transactions.
 */
function assertDemoTarget(target: DemoSeedTarget) {
  if (target.otherEnvironmentRows > 0) {
    throw new DemoSeedRefusal(`Refusing to seed: the database contains ${target.otherEnvironmentRows} accounts or bank connections outside the SANDBOX banking environment.`);
  }

  if (target.foreignManualTransactions > 0) {
    throw new DemoSeedRefusal(`Refusing to seed: the database contains ${target.foreignManualTransactions} transactions on manual or CSV accounts that the demo seed did not create.`);
  }
}

/** Reuses a category someone created with the same name instead of adding a conflicting demo category. */
async function resolveCategories() {
  const foreign = await listForeignCategories();
  const mapping = new Map<string, string>();
  const created = demoCategories.filter(category => {
    const existing = foreign.find(row => sameCategoryName(row.name, category.name));

    mapping.set(category.id, existing?.id ?? category.id);

    return !existing;
  });

  return {
    created,
    categoryId: (id: string) => mapping.get(id) ?? id
  };
}

/** Checks the request itself, so the command can refuse before it opens the database. */
export function assertDemoSeedRequest(options: DemoSeedOptions) {
  if (!options.confirmed) {
    throw new DemoSeedRefusal("Refusing to seed without confirmation. Pass --confirm to replace the demo rows in the configured database.");
  }

  if (environment() !== "SANDBOX") {
    throw new DemoSeedRefusal("Refusing to seed: ENABLE_BANKING_ENVIRONMENT must be SANDBOX.");
  }
}

export async function seedDemoData(options: DemoSeedOptions) {
  assertDemoSeedRequest(options);

  const bankingEnvironment = environment();
  const dataset = buildDemoDataset(options.runDate ?? today());
  const categories = await resolveCategories();
  const rules: Rule[] = demoRules.map(rule => ({
    id: rule.id,
    name: rule.name,
    pattern: rule.pattern,
    mode: rule.mode,
    category_id: categories.categoryId(rule.categoryId),
    priority: rule.priority,
    enabled: rule.enabled ? 1 : 0
  }));
  const accounts = dataset.accounts.map(account => ({
    ...account,
    entries: categorizeEntries(account.entries, rules)
  }));

  await replaceDemoRows({
    environment: bankingEnvironment,
    categories: categories.created,
    rules,
    accounts
  }, assertDemoTarget);

  return {
    firstDate: dataset.firstDate,
    runDate: dataset.runDate,
    ...(await countDemoRows())
  };
}
