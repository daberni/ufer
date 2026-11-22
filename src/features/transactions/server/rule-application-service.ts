import { HttpError } from "@/lib/errors";
import { database, type DatabaseTransaction } from "@/server/database/connection";
import { prepareRules, type Rule } from "@/features/categorization/server/rule-assignment";
import { decideAdoptedTypes, decideRuleCategoryChanges, decideRuleTypeChanges, decidedBy, decidedByStoredRule, type SelectRuleAssignments } from "@/features/categorization/server/rule-decisions";
import { RuleLimitReached, appendedPriority, readRules, removeRule, storeRule, storeRuleDetails, storeRuleEnabled, storeRuleOrder, type NewRule, type RuleDetails } from "@/features/categorization/server/rule-repository";
import { inactiveTargetError, parseRuleCreation, parseRuleEnabled, parseRuleOrder, parseRulePreview, parseRuleUpdate, ruleLimitError } from "@/features/categorization/server/categorization-service";
import { adoptManualAssignments, adoptSourceTransaction, categorizeByRule, clearRuleReferences, findManualAssignments, findPreviewedTransactions, findRuleTypeableTransactions, findUncorrectedTransactions, readManualCandidates, readSourceCandidates, readTypeableBookings, readUncategorizedCandidates, storeRuleAssignments, storeRuleTypes, type PreviewedTransaction } from "./rule-booking-repository";

/** Manual assignments a rule takes over: the selector picks those the rule decides; the excluded transaction is handled separately. */
export type ManualAdoption = {
  select: SelectRuleAssignments;
  excludedTransactionId?: string;
};

/** What a new rule assigns in its creation transaction: matching uncategorized transactions, the manually categorized transaction it was created from, and other manual assignments a person chose to hand to it. */
export type RuleCreationAssignments = {
  uncategorized?: SelectRuleAssignments;
  source?: {
    transactionId: string;
    select: SelectRuleAssignments;
  };
  manual?: ManualAdoption;
};

type AssigningRule = Pick<Rule, "id" | "category_id" | "transaction_type" | "transfer_account_id">;

/** Returns the selected manual assignments to automatic categorization with the rule's category; resolves to the selected IDs. */
async function adoptManual(tx: DatabaseTransaction, rule: AssigningRule, rules: Rule[], adoption: ManualAdoption) {
  const candidates = await readManualCandidates(tx);
  const ids = adoption.select(rules, candidates.filter(candidate => candidate.id !== adoption.excludedTransactionId));

  await adoptManualAssignments(tx, rule, ids);

  return ids;
}

/** Hands the transaction a rule was created from to that rule when the selector confirms the rule decides its manual category; resolves to the adopted IDs. */
async function adoptSource(tx: DatabaseTransaction, rule: AssigningRule, rules: Rule[], source: NonNullable<RuleCreationAssignments["source"]>) {
  const adopted = source.select(rules, await readSourceCandidates(tx, source.transactionId, rule.category_id));

  if (adopted.length > 0) {
    await adoptSourceTransaction(tx, rule, source.transactionId);
  }

  return adopted;
}

/** Sets the rule's type on the bookings it was just given, unless a person or a link decided their type or their account is archived, then pairs transfers so they link to, or create, their counterparts. */
async function applyRuleType(tx: DatabaseTransaction, rule: AssigningRule, ids: string[]) {
  if (ids.length === 0) {
    return;
  }

  await storeRuleTypes(tx, decideAdoptedTypes(rule, await readTypeableBookings(tx, ids)));
}

async function assignNewRule(tx: DatabaseTransaction, rule: NewRule, assignments: RuleCreationAssignments) {
  const {
    uncategorized,
    source,
    manual
  } = assignments;

  if (!uncategorized && !source && !manual) {
    return 0;
  }

  const rules = await readRules(tx);
  const adopted = [...(source ? await adoptSource(tx, rule, rules, source) : []), ...(manual ? await adoptManual(tx, rule, rules, manual) : [])];

  if (!uncategorized) {
    await applyRuleType(tx, rule, adopted);

    return 0;
  }

  const ids = uncategorized(rules, await readUncategorizedCandidates(tx));
  const categorized = await categorizeByRule(tx, rule, ids);

  await applyRuleType(tx, rule, [...adopted, ...ids]);

  return categorized;
}

/** Stores the rule and its optional assignments in one write transaction; resolves to the number of categorized uncategorized bookings. */
export async function insertRule(rule: NewRule, assignments: RuleCreationAssignments = {}) {
  const db = await database();

  return db.transaction(async tx => {
    await storeRule(tx, rule);

    return assignNewRule(tx, rule, assignments);
  });
}

/** Stores a rule after every stored rule, with its optional assignments, in one write transaction. */
export async function appendRule(rule: Omit<NewRule, "priority">, assignments: RuleCreationAssignments = {}) {
  const db = await database();

  return db.transaction(async tx => {
    const placed = {
      ...rule,
      priority: await appendedPriority(tx)
    };

    await storeRule(tx, placed);

    return assignNewRule(tx, placed, assignments);
  });
}

/** Updates the rule's details; chosen manual assignments the updated rule decides are returned to it in the same write transaction. */
export async function updateRule(id: string, details: RuleDetails, manual?: ManualAdoption) {
  const db = await database();

  return db.transaction(async tx => {
    const result = await storeRuleDetails(tx, id, details);

    if (result === "saved" && manual) {
      const rule = {
        id,
        category_id: details.category_id,
        transaction_type: details.transaction_type,
        transfer_account_id: details.transfer_account_id
      };

      await applyRuleType(tx, rule, await adoptManual(tx, rule, await readRules(tx), manual));
    }

    return result;
  });
}

export async function createRule(payload: unknown) {
  const {
    rule,
    priority,
    applyToUncategorized,
    sourceTransactionId,
    adoptManual: adopt
  } = await parseRuleCreation(payload);
  const select = decidedByStoredRule(rule.id);
  const assignments: RuleCreationAssignments = {
    uncategorized: applyToUncategorized ? select : undefined,
    source: sourceTransactionId === undefined ? undefined : {
      transactionId: sourceTransactionId,
      select
    },
    manual: adopt ? {
      select,
      excludedTransactionId: sourceTransactionId
    } : undefined
  };

  try {
    const categorized = priority === undefined ? await appendRule(rule, assignments) : await insertRule({
      ...rule,
      priority
    }, assignments);

    return {
      ok: true,
      categorized
    };
  } catch (error) {
    if (error instanceof RuleLimitReached) {
      throw await ruleLimitError(error);
    }

    throw error;
  }
}

/** Existing assignments only change for the manual assignments a person chose to hand to the rule. */
export async function updateRuleDetails(id: string, payload: unknown) {
  const {
    details,
    adoptManual: adopt
  } = await parseRuleUpdate(payload);
  const result = await updateRule(id, details, adopt ? {
    select: decidedByStoredRule(id)
  } : undefined);

  if (result === "not_found") {
    throw new HttpError(404, "Rule not found.");
  }

  if (result === "inactive_target") {
    throw inactiveTargetError();
  }

  return {
    ok: true
  };
}

export async function updateRuleEnabled(id: string, payload: unknown) {
  const enabled = parseRuleEnabled(payload);
  const db = await database();

  if (!(await db.transaction(tx => storeRuleEnabled(tx, id, enabled)))) {
    throw new HttpError(404, "Rule not found.");
  }

  return {
    ok: true
  };
}

/** Deleting a rule keeps the categories and types it already assigned, without a reference to the deleted rule; only future applications of the rules change. */
export async function deleteRule(id: string) {
  const db = await database();
  const deleted = await db.transaction(async tx => {
    const removed = await removeRule(tx, id);

    await clearRuleReferences(tx, id);

    return removed;
  });

  if (!deleted) {
    throw new HttpError(404, "Rule not found.");
  }

  return {
    ok: true
  };
}

/** Stores a new matching order. Existing assignments stay unchanged until rules are applied. */
export async function reorderRules(payload: unknown) {
  const {
    ids,
    priorities
  } = parseRuleOrder(payload);
  const db = await database();

  if (!(await db.transaction(tx => storeRuleOrder(tx, ids, priorities)))) {
    throw new HttpError(409, "The rules have changed. Reload them and try again.");
  }

  return {
    ok: true
  };
}

// The preview lists the newest decided bookings; the counts cover all of them.
const previewListLimit = 50;

type Dated = {
  id: string;
  date: string;
};

function byNewest(first: Dated, second: Dated) {
  return second.date.localeCompare(first.date) || first.id.localeCompare(second.id);
}

function previewedTransaction(transaction: PreviewedTransaction) {
  return {
    id: transaction.id,
    date: transaction.date,
    amount_minor: transaction.amount_minor,
    currency: transaction.currency,
    payee: transaction.payee,
    description: transaction.description,
    category_id: transaction.category_id,
    manual: transaction.category_source === "manual"
  };
}

/**
 * Counts the transactions a new rule, or an edited rule in its stored enabled state, would categorize, without storing it. A disabled rule decides nothing. Manual
 * assignments are counted separately: they only follow the rule when a person chooses to return them to automatic categorization.
 */
export async function previewRule(payload: unknown) {
  const {
    draft,
    storedRules,
    categoryId,
    sourceTransactionId
  } = await parseRulePreview(payload);
  const db = await database();
  const enabled = draft.enabled;
  const decided = enabled ? decidedBy(draft, storedRules, await findUncorrectedTransactions(db)) : [];
  const manualAssignments = enabled ? (await findManualAssignments(db)).filter(entry => entry.id !== sourceTransactionId) : [];
  const decidedManual = decidedBy(draft, storedRules, manualAssignments);
  const listed = [...decided, ...decidedManual].sort(byNewest).slice(0, previewListLimit);
  const transactions = await findPreviewedTransactions(listed.map(entry => entry.id));

  return {
    id: draft.id,
    enabled: Boolean(enabled),
    matched: decided.length,
    uncategorized: decided.filter(entry => entry.category_id === null).length,
    matched_same_category: decided.filter(entry => categoryId !== undefined && entry.category_id === categoryId).length,
    manual: decidedManual.length,
    manual_same_category: decidedManual.filter(entry => categoryId !== undefined && entry.category_id === categoryId).length,
    transactions: transactions.map(previewedTransaction)
  };
}

/**
 * Re-applies the rules to rule-categorized bookings, then sets the types rules decide and pairs rule-set transfers. Recording which rule decides an unchanged category is
 * not reported as an update.
 */
export async function applyRulesToUncorrectedTransactions() {
  const db = await database();

  return db.transaction(async tx => {
    const rules = prepareRules(await readRules(tx));
    const categoryChanges = decideRuleCategoryChanges(await findUncorrectedTransactions(tx), rules);

    await storeRuleAssignments(tx, categoryChanges);

    const typeChanges = decideRuleTypeChanges(await findRuleTypeableTransactions(tx), rules);

    await storeRuleTypes(tx, typeChanges);

    return {
      updated: categoryChanges.filter(change => change.recategorized).length,
      retyped: typeChanges.filter(change => change.changed).length
    };
  });
}
