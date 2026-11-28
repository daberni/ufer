"use client";

import ui from "../../../components/ui/primitives.module.css";

import { useRef, useState } from "react";
import { clsx } from "clsx";
import { useTranslations } from "next-intl";
import panel from "../../transactions/components/transactions-panel.module.css";
import { TransactionPagination } from "@/features/transactions/components/transactions-panel";
import { TransactionList, TransactionListSkeleton } from "@/features/transactions/components/transaction-list";
import { TransactionRuleProvider } from "@/features/transactions/components/transaction-rule-provider";
import { useCategories } from "@/features/categorization/queries";
import { rangeTitle } from "@/features/insights/range-format";
import { useCategoryTransactions } from "@/features/insights/queries";
import { AreaPlaceholder } from "@/components/ui/area-placeholder";
import { Empty } from "@/components/ui/empty-state";
import { areaProps } from "@/components/ui/result-presentation";
import { pendingTogether, useAreaResult } from "@/components/ui/use-area-result";
import { lastPage, transactionPageSize } from "@/lib/pagination";
import { useLocale } from "@/client/locale-provider";
import { useCurrency } from "@/client/use-app-url";
import type { PeriodRange } from "@/lib/period-range";

/** The bookings of the category the insights are narrowed to, in the selected range, page by page. */
export function CategoryTransactions({
  range,
  category
}: {
  range: PeriodRange;
  category: string;
}) {
  const t = useTranslations("insights.transactions");
  const locale = useLocale();
  const currency = useCurrency();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const categories = useAreaResult(useCategories());
  const [paging, setPaging] = useState({
    range,
    page: 1
  });
  // Another range starts at its first page.
  const requested = paging.range === range ? paging.page : 1;
  const query = useCategoryTransactions(range, currency, category, requested);
  const list = useAreaResult(query);
  // Edits can shrink the matches below the shown page; the last page that still has matches takes its place.
  const loaded = query.isPlaceholderData ? undefined : query.data;
  const page = loaded ? Math.min(requested, lastPage(loaded.transactionCount)) : requested;

  // Adjusting state while rendering requests that page before the empty one is shown.
  if (page < requested) {
    setPaging({
      range,
      page
    });
  }

  return (
    <section className={clsx(ui["panel"], panel["transaction-panel"])}>
      <div className={panel["card-heading"]}>
        <h2 ref={headingRef} tabIndex={-1}>{t("title", {
          period: rangeTitle(range, locale)
        })}</h2>
      </div>
      <TransactionRuleProvider fallbackFocus={headingRef}>
        {list.status === "pending" || categories.status === "pending" ? (
          <AreaPlaceholder area={pendingTogether(list, categories)} failureTitle={t("failure")}>
            <TransactionListSkeleton rows={Math.min(transactionPageSize, 8)} />
          </AreaPlaceholder>
        ) : (
          <>
            <div {...areaProps(list.status)}>
              {list.data.transactions.length ? <TransactionList categories={categories.data} transactions={list.data.transactions} /> : <Empty title={t("emptyTitle")}>{t("empty")}</Empty>}
            </div>
            <TransactionPagination
              list={list}
              page={page}
              onPage={next => {
                setPaging({
                  range,
                  page: next
                });
                headingRef.current?.focus();
              }}
            />
          </>
        )}
      </TransactionRuleProvider>
    </section>
  );
}
