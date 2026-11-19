import assert from "node:assert/strict";
import { test } from "node:test";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { browser, respond, wait, withQueryClient } from "./fixtures/browser";
import { queryKeys } from "../src/client/query-keys";
import { useBalanceHistory } from "../src/features/accounts/queries";
import { useBalanceImport } from "../src/features/imports/mutations";
import { useSaveTransaction } from "../src/features/transactions/mutations";

const cachedHistory = {
  currency: "EUR",
  balances: [{
    date: "2026-01-01",
    amount_minor: 1000,
    source: "manual"
  }]
};

for (const operation of ["import", "transfer"] as const) {
  test(`${operation} refreshes active and cached balance histories before they become stale`, async context => {
    const environment = browser(context);

    environment.queryClient.setQueryData(queryKeys.balanceHistory("checking"), cachedHistory);
    environment.queryClient.setQueryData(queryKeys.balanceHistory("savings"), cachedHistory);
    const hook = renderHook(() => ({
      history: useBalanceHistory("checking"),
      importCsv: useBalanceImport(),
      edit: useSaveTransaction("entry")
    }), {
      wrapper: ({ children }: {
        children: ReactNode
      }) => withQueryClient(environment.queryClient, children)
    });

    await wait(0);
    assert.equal(environment.requests("accounts/checking/balance").length, 0);
    act(() => {
      if (operation === "import") {
        hook.result.current.importCsv.mutate({
          accountId: "checking",
          file: new File(["date,balance,currency"], "synthetic.csv")
        });
      } else {
        hook.result.current.edit.mutate({
          type: "transfer",
          transfer: {
            account_id: "savings"
          }
        });
      }
    });
    await wait(0);
    const path = operation === "import" ? "imports/balances" : "transactions/entry/details";

    await respond(environment.requests(path)[0], Response.json({
      ok: true
    }));
    assert.equal(environment.queryClient.getQueryState(queryKeys.balanceHistory("savings"))?.isInvalidated, true);
    assert.equal(environment.requests("accounts/checking/balance").length, 1);
    await respond(environment.requests("accounts/checking/balance")[0], Response.json({
      ...cachedHistory,
      balances: [{
        date: "2026-01-01",
        amount_minor: 1200,
        source: "manual"
      }]
    }));
    assert.equal(hook.result.current.history.data?.balances[0].amount_minor, 1200);
  });
}
