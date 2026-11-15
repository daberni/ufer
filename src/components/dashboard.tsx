"use client";

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { ArrowDownLeft, ArrowDownToLine, ArrowRight, ArrowUpRight, Building2, Check, ChevronLeft, ChevronRight, CircleHelp, CreditCard, Landmark, LayoutDashboard, Link2, LogOut, Plus, RefreshCw, Search, ShieldCheck, SlidersHorizontal, Sparkles, Sprout, Wallet, X } from "lucide-react";
import { money, viennaMonth } from "@/lib/money";

type Account = { id: string; name: string; institution: string; kind: string; currency: string; balance_minor: number | null; balance_date: string | null; provider: string; last_synced_at: string | null; valid_until: string | null; sync_error: string | null };
type Category = { id: string; name: string; color: string; is_transfer: number };
type Transaction = { id: string; booking_date: string; amount_minor: number; currency: string; counterparty: string; description: string; account_name: string; category_id: string | null; category_source: string };
type Rule = { id: string; name: string; pattern: string; mode: string; category_name: string; priority: number; enabled: number; category_color: string };
type Connection = { id: string; bank_name: string; bank_country: string; status: string; valid_until: string | null; error: string | null };
type State = { environment: string; bankingConfigured: boolean; passwordConfigured: boolean; currency: string; month: string; page: number; accounts: Account[]; transactions: Transaction[]; transactionCount: number; categories: Category[]; rules: Rule[]; connections: Connection[]; runs: { id: string; started_at: string; status: string; inserted_count: number; error: string | null }[]; summary: { netWorth: number; liquidity: number; investments: number; property: number; liabilities: number; unvalued: number; income: number; expenses: number }; breakdown: { name: string; color: string; amount: number }[]; trend: { month: string; income: number; expenses: number }[] };
type Bank = { name: string; country: string; beta?: boolean };
type View = "overview" | "transactions" | "accounts" | "rules" | "connections";
type Modal = "account" | "bank" | "rule" | "import" | "balance" | "category" | null;
const kinds: Record<string, string> = {
  checking: "Current account",
  savings: "Savings account",
  investment: "Investment account",
  loan: "Loan",
  property: "Property",
  credit_card: "Credit card",
};
const navigation = [
  { id: "overview" as View, label: "Overview", mobileLabel: "Overview", icon: LayoutDashboard },
  { id: "transactions" as View, label: "Transactions", mobileLabel: "Activity", icon: ArrowDownLeft },
  { id: "accounts" as View, label: "Accounts & assets", mobileLabel: "Accounts", icon: Wallet },
  { id: "rules" as View, label: "Categories & rules", mobileLabel: "Rules", icon: SlidersHorizontal },
  { id: "connections" as View, label: "Bank connections", mobileLabel: "Banks", icon: Link2 },
];

function date(value: string | null) {
  return value ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(new Date(value)) : "No balance yet";
}
function monthLabel(value: string) {
  return new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}-01T12:00:00Z`));
}
function accountIcon(kind: string) {
  return kind === "property" ? Building2 : kind === "investment" ? Sprout : kind === "credit_card" ? CreditCard : Landmark;
}

async function api<T>(path: string, body?: unknown, method = "POST"): Promise<T> {
  const response = await fetch(`/api/${path}`, { method: body === undefined && method === "POST" ? "GET" : method, headers: { "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error || "Request failed."), { status: response.status });
  return data as T;
}

function Empty({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Sprout size={24} />
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}

export default function Dashboard() {
  const [view, setView] = useState<View>("overview");
  const [state, setState] = useState<State | null>(null);
  const [month, setMonth] = useState(viennaMonth());
  const [currency, setCurrency] = useState("EUR");
  const [search, setSearch] = useState("");
  const [accountFilter, setAccountFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [allMonths, setAllMonths] = useState(false);
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState<Modal>(null);
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [locked, setLocked] = useState(false);
  const [banks, setBanks] = useState<Bank[]>([]);
  const [bankCountry, setBankCountry] = useState("AT");
  const [bankSearch, setBankSearch] = useState("");
  const [bankName, setBankName] = useState("");
  const [banksLoading, setBanksLoading] = useState(false);
  const [importMode, setImportMode] = useState("balances");

  const load = useCallback(
    async (signal?: AbortSignal) => {
      const query = new URLSearchParams({ month, currency, page: String(page), search, account: accountFilter, category: categoryFilter, allMonths: allMonths ? "1" : "0" });
      const response = await fetch(`/api/state?${query}`, { cache: "no-store", signal });
      const data = await response.json();
      if (response.status === 401) {
        setLocked(true);
        return;
      }
      if (!response.ok) throw new Error(data.error);
      setState(data);
      setLocked(false);
    },
    [month, currency, page, search, accountFilter, categoryFilter, allMonths],
  );

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      load(controller.signal).catch((error) => {
        if (error.name !== "AbortError") setError(error.message);
      });
    }, 180);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [load]);
  useEffect(() => {
    const result = new URLSearchParams(window.location.search).get("banking");
    if (result) {
      setView("connections");
      if (result === "connected") setNotice("Bank connected. Select “Sync” to retrieve balances and transactions for the first time.");
      else setError(result);
      window.history.replaceState(null, "", "/");
    }
  }, []);
  useEffect(() => {
    if (modal !== "bank") return;
    let active = true;
    setBanksLoading(true);
    setBanks([]);
    api<{ banks: Bank[] }>(`banks?country=${bankCountry}`)
      .then((data) => {
        if (active) {
          setBanks(data.banks);
          setBankName((current) => (data.banks.some((bank) => bank.name === current) ? current : ""));
        }
      })
      .catch((error) => {
        if (active) setError(error.message);
      })
      .finally(() => {
        if (active) setBanksLoading(false);
      });
    return () => {
      active = false;
    };
  }, [modal, bankCountry]);
  useEffect(() => {
    if (!modal) return;
    const before = document.activeElement as HTMLElement;
    const dialog = document.querySelector<HTMLDialogElement>("dialog");
    dialog?.showModal();
    return () => {
      dialog?.close();
      before?.focus();
    };
  }, [modal]);

  async function perform(action: () => Promise<unknown>, success?: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      await load();
      if (success) setNotice(success);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Request failed.");
    } finally {
      setBusy(false);
    }
  }
  function changeView(next: View) {
    setView(next);
    setPage(1);
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  function moveMonth(delta: number) {
    const next = new Date(`${month}-01T12:00:00Z`);
    next.setUTCMonth(next.getUTCMonth() + delta);
    setMonth(next.toISOString().slice(0, 7));
    setPage(1);
  }
  function openBank(connection?: Connection) {
    setError("");
    setBankName(connection?.bank_name || "");
    setBankSearch("");
    setBankCountry(connection?.bank_country || "AT");
    setModal("bank");
  }
  async function submit(event: FormEvent<HTMLFormElement>, action: (data: FormData) => Promise<void>, message: string) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await perform(async () => {
      await action(data);
      setModal(null);
    }, message);
  }

  if (locked)
    return (
      <main className="login-page">
        <form
          className="login-card"
          onSubmit={(event) => {
            event.preventDefault();
            const password = new FormData(event.currentTarget).get("password");
            perform(async () => {
              await api("auth/login", { password });
              setLocked(false);
            });
          }}
        >
          <div className="brand-symbol">
            <Sprout />
          </div>
          <span className="eyebrow">YOUR PERSONAL OVERVIEW</span>
          <h1>Welcome back.</h1>
          <p>Your finances, under your control.</p>
          <label>
            Password
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              autoFocus
            />
          </label>
          {error && (
            <p
              role="alert"
              className="error-text"
            >
              {error}
            </p>
          )}
          <button
            className="button primary"
            disabled={busy}
          >
            Open dashboard <ArrowRight size={16} />
          </button>
        </form>
      </main>
    );

  const summary = state?.summary;
  const currencies = [...new Set(["EUR", ...(state?.accounts.map((account) => account.currency) || [])])];
  const selectedCurrencyAccounts = state?.accounts.filter((account) => account.currency === currency) || [];
  const bankAccounts = state?.accounts.filter((account) => account.provider === "enable_banking") || [];
  const expiring = bankAccounts.filter((account) => account.valid_until && Date.parse(account.valid_until) - Date.now() < 7 * 86400_000);
  const visibleTransactions = view === "overview" ? state?.transactions.slice(0, 5) : state?.transactions;
  const nav = navigation.find((item) => item.id === view)!;
  const trend = Array.from({ length: 6 }, (_, index) => {
    const d = new Date(`${month}-01T12:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - 5 + index);
    const key = d.toISOString().slice(0, 7);
    return state?.trend.find((item) => item.month === key) || { month: key, income: 0, expenses: 0 };
  });
  const trendMax = Math.max(1, ...trend.flatMap((item) => [item.income, item.expenses]));
  const totalExpenses = state?.breakdown.reduce((sum, item) => sum + item.amount, 0) || 0;

  function transactionCategory(transaction: Transaction) {
    return (
      <select
        className="category-select"
        aria-label={`Category for ${transaction.counterparty || transaction.description}`}
        value={transaction.category_id || ""}
        disabled={busy}
        onChange={(event) => perform(() => api(`transactions/${transaction.id}`, { category_id: event.target.value || null }, "PATCH"))}
      >
        <option value="">Uncategorized</option>
        {state?.categories.map((category) => (
          <option
            key={category.id}
            value={category.id}
          >
            {category.name}
          </option>
        ))}
      </select>
    );
  }

  function transactionTable() {
    return (
      <>
        <div className="table-scroll desktop-transactions">
          <table>
            <thead>
              <tr>
                <th>Payee / description</th>
                <th>Category</th>
                <th>Account</th>
                <th>Date</th>
                <th className="align-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {visibleTransactions?.map((transaction) => (
                <tr key={transaction.id}>
                  <td>
                    <div className="transaction-name">
                      <span className={`transaction-icon ${transaction.amount_minor > 0 ? "incoming" : ""}`}>{transaction.amount_minor > 0 ? <ArrowDownLeft size={17} /> : <ArrowUpRight size={17} />}</span>
                      <div>
                        <strong>{transaction.counterparty || transaction.description || "Transaction"}</strong>
                        <span title={transaction.description}>{transaction.description || "No description"}</span>
                      </div>
                    </div>
                  </td>
                  <td>
                    {transactionCategory(transaction)}
                    {transaction.category_source === "manual" && (
                      <span
                        className="manual-dot"
                        title="Manually assigned; preserved when syncing and applying rules"
                      />
                    )}
                  </td>
                  <td className="muted">{transaction.account_name}</td>
                  <td className="muted nowrap">{date(transaction.booking_date)}</td>
                  <td className={`amount align-right ${transaction.amount_minor > 0 ? "positive" : ""}`}>
                    {transaction.amount_minor > 0 ? "+" : ""}
                    {money(transaction.amount_minor, transaction.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul
          className="transaction-cards"
          aria-label="Transactions"
        >
          {visibleTransactions?.map((transaction) => (
            <li key={transaction.id}>
              <article className="transaction-card">
                <div className="transaction-card-meta">
                  <span>{transaction.account_name}</span>
                  <time dateTime={transaction.booking_date}>{date(transaction.booking_date)}</time>
                </div>
                <div className="transaction-card-heading">
                  <h3>{transaction.counterparty || transaction.description || "Transaction"}</h3>
                  <strong className={`amount ${transaction.amount_minor > 0 ? "positive" : ""}`}>
                    {transaction.amount_minor > 0 ? "+" : ""}
                    {money(transaction.amount_minor, transaction.currency)}
                  </strong>
                </div>
                {transaction.description && (
                  <details className="transaction-details">
                    <summary>Description</summary>
                    <p>{transaction.description}</p>
                  </details>
                )}
                <div className="transaction-card-category">
                  <span>Category{transaction.category_source === "manual" && <small>Manually assigned</small>}</span>
                  {transactionCategory(transaction)}
                </div>
              </article>
            </li>
          ))}
        </ul>
      </>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="/"
        >
          <span className="brand-symbol">
            <Sprout size={24} />
          </span>
          <span>
            ufer
            <small>ALL IN ONE PLACE.</small>
          </span>
        </a>
        <div className="workspace">
          <span className="workspace-avatar">P</span>
          <div>
            My finances<small>Personal workspace</small>
          </div>
          <ShieldCheck size={15} />
        </div>
        <span className="nav-label">MY OVERVIEW</span>
        <nav>
          {navigation.map((item) => (
            <button
              key={item.id}
              aria-label={item.label}
              aria-current={view === item.id ? "page" : undefined}
              className={`nav-item ${view === item.id ? "active" : ""}`}
              onClick={() => changeView(item.id)}
            >
              <item.icon size={18} />
              <span className="nav-full-label">{item.label}</span>
              <span
                className="nav-mobile-label"
                aria-hidden="true"
              >
                {item.mobileLabel}
              </span>
              {item.id === "connections" && expiring.length > 0 && <span className="nav-count">{expiring.length}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="privacy-note">
            <ShieldCheck size={20} />
            <strong>Your data. Your perspective.</strong>
            <p>
              Self-hosted.
              <br />
              Bank access through Enable Banking.
            </p>
          </div>
          <span className="sidebar-foot">
            <span className="status-dot" />
            {state?.environment === "PRODUCTION" ? "Production data" : "Sandbox · test data"}
          </span>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <span>
            My finances <ChevronRight size={13} />
            <strong>{nav.label}</strong>
          </span>
          <div>
            <span className="environment-pill">{state?.environment === "PRODUCTION" ? "PRODUCTION" : "SANDBOX"}</span>
            {state?.passwordConfigured && (
              <button
                className="icon-button"
                aria-label="Sign out"
                onClick={() =>
                  perform(async () => {
                    await api("auth/logout", {});
                    setLocked(true);
                  })
                }
              >
                <LogOut size={18} />
              </button>
            )}
            <span className="avatar">P</span>
          </div>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <span className="eyebrow">CLARITY FOR YOUR FINANCES</span>
              <h1>{nav.label === "Overview" ? "Your money. In perspective." : nav.label}</h1>
              <p>{view === "overview" ? "A clear picture is the first step forward." : view === "transactions" ? "Every transaction, across all your accounts." : view === "accounts" ? "Your accounts and assets, together in one place." : view === "rules" ? "Less sorting. More clarity." : "Connect your banks and keep track of their authorizations."}</p>
            </div>
            <button
              className="button primary"
              disabled={busy || !bankAccounts.length}
              onClick={() =>
                perform(async () => {
                  const result = await api<{ inserted: number; failures: string[] }>("sync", {});
                  if (result.failures.length) setError(result.failures.join(" · "));
                  setNotice(`${result.inserted} new transactions synced.`);
                })
              }
            >
              <RefreshCw
                size={15}
                className={busy ? "spinning" : ""}
              />
              {busy ? "Processing …" : "Sync"}
            </button>
          </div>
          <div aria-live="polite">
            {notice && (
              <div className="notice">
                <Check size={17} />
                {notice}
                <button
                  className="icon-button"
                  aria-label="Dismiss notice"
                  onClick={() => setNotice("")}
                >
                  <X size={15} />
                </button>
              </div>
            )}
            {error && (
              <div
                className="notice error"
                role="alert"
              >
                <CircleHelp size={18} />
                {error}
                <button
                  className="icon-button"
                  aria-label="Dismiss error"
                  onClick={() => setError("")}
                >
                  <X size={15} />
                </button>
              </div>
            )}
          </div>
          {state?.environment === "SANDBOX" && (
            <div className="sandbox-note">
              <span className="status-dot" />
              Sandbox mode: linked banks provide test data. Real accounts require a separate production application.
            </div>
          )}
          {expiring.length > 0 && (
            <div className="notice warning">
              <Link2 size={17} />
              {expiring.length} bank authorization(s) are expiring or have expired.
              <button
                className="text-button"
                onClick={() => changeView("connections")}
              >
                Review authorizations <ArrowRight size={14} />
              </button>
            </div>
          )}
          {!state ? (
            <div className="loading-state">
              <RefreshCw
                size={22}
                className="spinning"
              />{" "}
              Loading dashboard …
            </div>
          ) : (
            <>
              {(view === "overview" || view === "transactions") && (
                <div className="period-bar">
                  <div>
                    <span className="section-kicker">{view === "overview" ? "NET WORTH & MONTHLY CASH FLOW" : `${state.transactionCount} ${state.transactionCount === 1 ? "TRANSACTION" : "TRANSACTIONS"}`}</span>
                    {view === "overview" && <span className="subtle">{state.runs[0] ? `Last sync: ${date(state.runs[0].started_at)} · ${state.runs[0].status === "SUCCESS" ? "successful" : state.runs[0].status === "PARTIAL" ? "partial" : state.runs[0].status === "RUNNING" ? "running" : "failed"}` : "No sync yet"}</span>}
                  </div>
                  <div className="period-controls">
                    <select
                      aria-label="Display currency"
                      value={currency}
                      onChange={(event) => {
                        setCurrency(event.target.value);
                        setPage(1);
                      }}
                    >
                      {currencies.map((value) => (
                        <option key={value}>{value}</option>
                      ))}
                    </select>
                    <button
                      className="icon-button"
                      aria-label="Previous month"
                      onClick={() => moveMonth(-1)}
                    >
                      <ChevronLeft size={17} />
                    </button>
                    <label className="month-label">
                      <span>{monthLabel(month)}</span>
                      <input
                        aria-label="Select month"
                        type="month"
                        value={month}
                        onChange={(event) => {
                          if (event.target.value) {
                            setMonth(event.target.value);
                            setPage(1);
                          }
                        }}
                      />
                    </label>
                    <button
                      className="icon-button"
                      aria-label="Next month"
                      onClick={() => moveMonth(1)}
                    >
                      <ChevronRight size={17} />
                    </button>
                  </div>
                </div>
              )}
              {view === "overview" && (
                <>
                  <div className="wealth-grid">
                    <section className="wealth-card">
                      <div className="wealth-card-top">
                        <span>
                          <span className="wealth-mark">
                            <Wallet size={17} />
                          </span>
                          Net worth
                        </span>
                        <span className="small-tag">{currency}</span>
                      </div>
                      <div className="wealth-number">{selectedCurrencyAccounts.length ? money(summary!.netWorth, currency) : "—"}</div>
                      <p>Latest known balances · independent of the month filter{summary!.unvalued > 0 ? ` · ${summary!.unvalued} without a balance` : ""}</p>
                      <div
                        className="allocation-bar"
                        aria-hidden="true"
                      >
                        <span style={{ flex: Math.max(0, summary!.liquidity) }} />
                        <span style={{ flex: Math.max(0, summary!.investments) }} />
                        <span style={{ flex: Math.max(0, summary!.property) }} />
                      </div>
                      <div className="wealth-allocation">
                        <span>
                          <i className="legend-dot liquid" />
                          Cash<strong>{money(summary!.liquidity, currency)}</strong>
                        </span>
                        <span>
                          <i className="legend-dot invested" />
                          Investments<strong>{money(summary!.investments, currency)}</strong>
                        </span>
                        <span>
                          <i className="legend-dot property" />
                          Property<strong>{money(summary!.property, currency)}</strong>
                        </span>
                      </div>
                      {summary!.liabilities !== 0 && (
                        <div className="liabilities">
                          Loans <span>{money(summary!.liabilities, currency)}</span>
                        </div>
                      )}
                    </section>
                    <section className="month-card">
                      <div className="card-heading">
                        <h2>Your month</h2>
                        <span className="subtle">{monthLabel(month)}</span>
                      </div>
                      <div className="flow-row">
                        <span className="flow-icon incoming">
                          <ArrowDownLeft size={19} />
                        </span>
                        <div>
                          <span>Income</span>
                          <strong className="positive">{money(summary!.income, currency)}</strong>
                        </div>
                        <span className="flow-track">
                          <i style={{ width: `${summary!.income ? 100 : 0}%` }} />
                        </span>
                      </div>
                      <div className="flow-row">
                        <span className="flow-icon outgoing">
                          <ArrowUpRight size={19} />
                        </span>
                        <div>
                          <span>Expenses</span>
                          <strong>{money(summary!.expenses, currency)}</strong>
                        </div>
                        <span className="flow-track expense">
                          <i style={{ width: `${Math.min(100, (summary!.expenses / Math.max(summary!.income, summary!.expenses, 1)) * 100)}%` }} />
                        </span>
                      </div>
                      <div className="monthly-result">
                        <div>
                          <span>Monthly cash flow</span>
                          <small>Excluding categorized transfers</small>
                        </div>
                        <strong className={summary!.income - summary!.expenses >= 0 ? "positive" : ""}>{money(summary!.income - summary!.expenses, currency)}</strong>
                      </div>
                    </section>
                  </div>
                  <section className="accounts-section">
                    <div className="section-heading">
                      <h2>
                        Your accounts <span className="count-badge">{selectedCurrencyAccounts.length}</span>
                      </h2>
                      <button
                        className="text-button"
                        onClick={() => changeView("accounts")}
                      >
                        Manage all <ArrowRight size={15} />
                      </button>
                    </div>
                    {selectedCurrencyAccounts.length ? (
                      <div className="account-strip">
                        {selectedCurrencyAccounts.slice(0, 4).map((account) => {
                          const Icon = accountIcon(account.kind);
                          return (
                            <button
                              className="account-tile"
                              key={account.id}
                              onClick={() => {
                                setSelectedAccount(account);
                                if (account.provider === "manual") setModal("balance");
                                else changeView("accounts");
                              }}
                            >
                              <span className={`account-logo ${account.kind}`}>
                                <Icon size={21} />
                              </span>
                              <span className="account-tile-name">
                                {account.name}
                                <small>
                                  {kinds[account.kind]} · {account.institution}
                                </small>
                              </span>
                              <strong>{account.balance_minor === null ? "—" : money(account.balance_minor, account.currency)}</strong>
                              <span className="account-tile-foot">
                                <span className={`status-dot ${account.sync_error ? "warn" : ""}`} />
                                {account.provider === "manual" ? "Manual" : account.sync_error ? "Check sync" : "Bank-Sync"}
                                <span>{date(account.balance_date)}</span>
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="onboarding">
                        <span className="onboarding-icon">
                          <Landmark size={27} />
                        </span>
                        <div>
                          <h3>Your overview starts with your first account.</h3>
                          <p>Connect a sandbox bank or add a manually valued asset.</p>
                        </div>
                        <button
                          className="button primary"
                          onClick={() => openBank()}
                        >
                          <Plus size={15} />
                          Connect bank
                        </button>
                        <button
                          className="button"
                          onClick={() => setModal("account")}
                        >
                          Add manually
                        </button>
                      </div>
                    )}
                  </section>
                  <div className="analytics-grid">
                    <section className="panel">
                      <div className="card-heading">
                        <h2>Income & expenses</h2>
                        <span className="subtle">Last 6 months</span>
                      </div>
                      <div className="chart-legend">
                        <span>
                          <i className="legend-dot liquid" />
                          Income
                        </span>
                        <span>
                          <i className="legend-dot expense-dot" />
                          Expenses
                        </span>
                      </div>
                      <div
                        className="bar-chart"
                        role="img"
                        aria-label={`Monthly income and expenses for ${trend.map((item) => `${monthLabel(item.month)}: Income ${money(item.income, currency)}, Expenses ${money(item.expenses, currency)}`).join("; ")}`}
                      >
                        <div className="chart-grid">
                          <span />
                          <span />
                          <span />
                          <span />
                        </div>
                        {trend.map((item) => (
                          <div
                            className="bar-group"
                            key={item.month}
                          >
                            <div className="bars">
                              <span
                                className="income-bar"
                                style={{ height: `${(item.income / trendMax) * 100}%` }}
                                title={money(item.income, currency)}
                              />
                              <span
                                className="expense-bar"
                                style={{ height: `${(item.expenses / trendMax) * 100}%` }}
                                title={money(item.expenses, currency)}
                              />
                            </div>
                            <span>{new Intl.DateTimeFormat("en-GB", { month: "short" }).format(new Date(`${item.month}-01`))}</span>
                          </div>
                        ))}
                      </div>
                      {!state.trend.length && <p className="chart-empty-note">Your history appears here after the first import.</p>}
                    </section>
                    <section className="panel">
                      <div className="card-heading">
                        <h2>Where your money goes</h2>
                        <span className="subtle">{monthLabel(month)}</span>
                      </div>
                      {state.breakdown.length ? (
                        <div className="category-breakdown">
                          {state.breakdown.slice(0, 5).map((item) => (
                            <div
                              className="breakdown-row"
                              key={item.name}
                            >
                              <span>
                                <i
                                  className="legend-dot"
                                  style={{ background: item.color }}
                                />
                                {item.name}
                              </span>
                              <strong>{money(item.amount, currency)}</strong>
                              <div>
                                <i style={{ width: `${(item.amount / totalExpenses) * 100}%`, background: item.color }} />
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <Empty title="No expenses yet">Your spending breakdown appears here once transactions are available.</Empty>
                      )}
                    </section>
                  </div>
                </>
              )}
              {(view === "overview" || view === "transactions") && (
                <section className="panel transaction-panel">
                  <div className="card-heading">
                    <h2>{view === "overview" ? "Recent transactions" : "All transactions"}</h2>
                    {view === "overview" ? (
                      <button
                        className="text-button"
                        onClick={() => changeView("transactions")}
                      >
                        View all <ArrowRight size={15} />
                      </button>
                    ) : (
                      <button
                        className="button small"
                        onClick={() => setModal("import")}
                      >
                        <ArrowDownToLine size={14} />
                        Import CSV
                      </button>
                    )}
                  </div>
                  {view === "transactions" && (
                    <div className="filters">
                      <label className="search-field">
                        <Search size={16} />
                        <input
                          aria-label="Search transactions"
                          placeholder="Payee or description …"
                          value={search}
                          onChange={(event) => {
                            setSearch(event.target.value);
                            setPage(1);
                          }}
                        />
                      </label>
                      <select
                        aria-label="Account filter"
                        value={accountFilter}
                        onChange={(event) => {
                          setAccountFilter(event.target.value);
                          setPage(1);
                        }}
                      >
                        <option value="">All accounts</option>
                        {selectedCurrencyAccounts.map((account) => (
                          <option
                            key={account.id}
                            value={account.id}
                          >
                            {account.name}
                          </option>
                        ))}
                      </select>
                      <select
                        aria-label="Category filter"
                        value={categoryFilter}
                        onChange={(event) => {
                          setCategoryFilter(event.target.value);
                          setPage(1);
                        }}
                      >
                        <option value="">All categories</option>
                        <option value="uncategorized">Uncategorized</option>
                        {state.categories.map((category) => (
                          <option
                            key={category.id}
                            value={category.id}
                          >
                            {category.name}
                          </option>
                        ))}
                      </select>
                      <label className="check-label">
                        <input
                          type="checkbox"
                          checked={allMonths}
                          onChange={(event) => {
                            setAllMonths(event.target.checked);
                            setPage(1);
                          }}
                        />
                        All months
                      </label>
                    </div>
                  )}
                  {visibleTransactions?.length ? transactionTable() : <Empty title="Your financial history starts here.">Connect a bank account and sync, or import your existing transactions from CSV.</Empty>}
                  {view === "transactions" && state.transactionCount > 50 && (
                    <div className="pagination">
                      <span>
                        {(page - 1) * 50 + 1}–{Math.min(page * 50, state.transactionCount)} of {state.transactionCount}
                      </span>
                      <button
                        className="button small"
                        disabled={page === 1}
                        onClick={() => setPage(page - 1)}
                      >
                        Previous
                      </button>
                      <button
                        className="button small"
                        disabled={page * 50 >= state.transactionCount}
                        onClick={() => setPage(page + 1)}
                      >
                        Next
                      </button>
                    </div>
                  )}
                </section>
              )}
              {view === "accounts" && (
                <>
                  <div className="section-heading">
                    <span className="section-kicker">{state.accounts.length} ACCOUNTS & ASSETS</span>
                    <div className="button-group">
                      <button
                        className="button"
                        onClick={() => setModal("import")}
                      >
                        <ArrowDownToLine size={15} />
                        Import CSV
                      </button>
                      <button
                        className="button"
                        onClick={() => setModal("account")}
                      >
                        <Plus size={15} />
                        Add manually
                      </button>
                      <button
                        className="button primary"
                        onClick={() => openBank()}
                      >
                        <Link2 size={15} />
                        Connect bank
                      </button>
                    </div>
                  </div>
                  {state.accounts.length ? (
                    <div className="accounts-grid">
                      {state.accounts.map((account) => {
                        const Icon = accountIcon(account.kind);
                        return (
                          <section
                            className="panel account-detail"
                            key={account.id}
                          >
                            <div className="card-heading">
                              <span className={`account-logo ${account.kind}`}>
                                <Icon size={23} />
                              </span>
                              <span className="pill">{kinds[account.kind]}</span>
                            </div>
                            <h2>{account.name}</h2>
                            <p className="muted">{account.institution}</p>
                            <strong className="account-detail-balance">{account.balance_minor === null ? "—" : money(account.balance_minor, account.currency)}</strong>
                            <div className="account-detail-meta">
                              <span>Balance {date(account.balance_date)}</span>
                              <span>{account.provider === "manual" ? "Manual / import" : "Enable Banking"}</span>
                            </div>
                            {account.sync_error && <p className="error-text">{account.sync_error}</p>}
                            {account.provider === "manual" && (
                              <button
                                className="button full-width"
                                onClick={() => {
                                  setSelectedAccount(account);
                                  setModal("balance");
                                }}
                              >
                                Update balance <ArrowRight size={15} />
                              </button>
                            )}
                          </section>
                        );
                      })}
                    </div>
                  ) : (
                    <section className="panel">
                      <Empty title="Everything in one place">
                        Add accounts and manually valued assets to build your overview.
                        <button
                          className="button primary"
                          onClick={() => setModal("account")}
                        >
                          <Plus size={15} />
                          Add your first asset
                        </button>
                      </Empty>
                    </section>
                  )}
                </>
              )}
              {view === "rules" && (
                <>
                  <div className="section-heading">
                    <span className="section-kicker">LOWER PRIORITY NUMBERS MATCH FIRST</span>
                    <div className="button-group">
                      <button
                        className="button"
                        disabled={busy}
                        onClick={() => perform(() => api("rules/apply", {}), "Rules applied. Manual assignments have been preserved.")}
                      >
                        <Sparkles size={15} />
                        Apply rules
                      </button>
                      <button
                        className="button primary"
                        onClick={() => setModal("rule")}
                      >
                        <Plus size={15} />
                        Create rule
                      </button>
                    </div>
                  </div>
                  <section className="panel">
                    {state.rules.length ? (
                      <div className="rules-list">
                        {state.rules.map((rule) => (
                          <div
                            className="rule-row"
                            key={rule.id}
                          >
                            <span className="rule-priority">{rule.priority}</span>
                            <div>
                              <strong>{rule.name}</strong>
                              <p>
                                <code>{rule.pattern}</code> · {rule.mode === "keyword" ? "Keyword" : "Regex"}
                              </p>
                            </div>
                            <span
                              className="pill"
                              style={{ color: rule.category_color }}
                            >
                              {rule.category_name}
                            </span>
                            <button
                              className={`toggle ${rule.enabled ? "enabled" : ""}`}
                              role="switch"
                              aria-checked={Boolean(rule.enabled)}
                              aria-label={`Enable rule ${rule.name}`}
                              disabled={busy}
                              onClick={() => perform(() => api(`rules/${rule.id}`, { enabled: !rule.enabled }, "PATCH"))}
                            >
                              <span />
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <Empty title="Let your transactions sort themselves.">For example: “MARKET” in the payee or description → Groceries. Manual corrections always take precedence.</Empty>
                    )}
                  </section>
                  <div className="section-heading">
                    <h2>Your categories</h2>
                    <button
                      className="button small"
                      onClick={() => setModal("category")}
                    >
                      <Plus size={14} />
                      Category
                    </button>
                  </div>
                  <div className="category-chips">
                    {state.categories.map((category) => (
                      <span
                        className="category-chip"
                        key={category.id}
                      >
                        <i
                          className="legend-dot"
                          style={{ background: category.color }}
                        />
                        {category.name}
                        {category.is_transfer ? " · excluded from cash flow" : ""}
                      </span>
                    ))}
                  </div>
                </>
              )}
              {view === "connections" && (
                <>
                  <div className="section-heading">
                    <span className="section-kicker">ENABLE BANKING · {state.environment}</span>
                    <button
                      className="button primary"
                      onClick={() => openBank()}
                    >
                      <Plus size={15} />
                      Connect bank
                    </button>
                  </div>
                  <div className="connection-info">
                    <ShieldCheck size={23} />
                    <div>
                      <strong>Authorize directly with your bank.</strong>
                      <p>Your private application key stays on your server. Bank authorizations need periodic renewal; their duration depends on the bank.</p>
                    </div>
                  </div>
                  {!state.bankingConfigured && <div className="notice warning">Configure the application ID and private key on the server to enable bank access.</div>}
                  <section className="panel">
                    {state.connections.length ? (
                      <div className="connections-list">
                        {state.connections.map((connection) => (
                          <div
                            className="connection-row"
                            key={connection.id}
                          >
                            <span className="account-logo checking">
                              <Landmark size={23} />
                            </span>
                            <div>
                              <h3>{connection.bank_name}</h3>
                              <p>
                                {connection.bank_country} · {connection.valid_until ? `Authorized until ${date(connection.valid_until)}` : "Authorization not completed yet"}
                              </p>
                              {connection.error && <p className="error-text">{connection.error}</p>}
                            </div>
                            <span className={`pill ${connection.status === "LINKED" ? "success" : ""}`}>{({ LINKED: "Connected", PENDING: "Pending", EXCHANGING: "Connecting", EXPIRED: "Expired", ERROR: "Review", SUPERSEDED: "Superseded" } as Record<string, string>)[connection.status] || connection.status}</span>
                            <button
                              className="button small"
                              disabled={busy}
                              onClick={() => openBank(connection)}
                            >
                              Reconnect
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <Empty title="Your first bank connection">
                        Choose an available sandbox bank to test the complete flow with synthetic data.
                        <button
                          className="button primary"
                          onClick={() => openBank()}
                        >
                          <Link2 size={15} />
                          Select sandbox bank
                        </button>
                      </Empty>
                    )}
                  </section>
                  {state.runs.length > 0 && (
                    <section className="panel sync-history">
                      <div className="card-heading">
                        <h2>Recent syncs</h2>
                      </div>
                      {state.runs.map((run) => (
                        <div
                          className="sync-row"
                          key={run.id}
                        >
                          <span>{date(run.started_at)}</span>
                          <span className="pill">{run.status}</span>
                          <span>{run.inserted_count} new transactions</span>
                          {run.error && <p className="error-text">{run.error}</p>}
                        </div>
                      ))}
                    </section>
                  )}
                </>
              )}
            </>
          )}
          <footer className="page-footer">
            <span>
              <Sprout size={14} /> Ufer
            </span>
            <span>A clearer view of your money.</span>
          </footer>
        </main>
      </div>
      {modal && (
        <dialog
          aria-labelledby="modal-title"
          className="modal"
          onCancel={() => setModal(null)}
          onClick={(event) => {
            if (event.target === event.currentTarget) setModal(null);
          }}
        >
          <div className="modal-content">
            <div className="modal-heading">
              <div>
                <span className="eyebrow">YOUR FINANCES</span>
                <h2 id="modal-title">{modal === "bank" ? "Connect bank" : modal === "account" ? "Add asset" : modal === "rule" ? "Create rule" : modal === "balance" ? "Update balance" : modal === "category" ? "Add category" : "Import CSV"}</h2>
              </div>
              <button
                className="icon-button"
                aria-label="Close dialog"
                onClick={() => setModal(null)}
              >
                <X size={20} />
              </button>
            </div>
            {error && (
              <p
                className="notice error"
                role="alert"
              >
                {error}
              </p>
            )}
            {modal === "bank" && (
              <form
                onSubmit={(event) =>
                  submit(
                    event,
                    async () => {
                      const result = await api<{ url: string }>("banking/connect", { bank: bankName, country: bankCountry });
                      window.location.assign(result.url);
                    },
                    "",
                  )
                }
              >
                <p className="form-description">{state?.environment === "SANDBOX" ? "You are connecting a test bank. Use only its sandbox credentials." : "After selecting a bank, authorize read-only access with your bank."}</p>
                <label>
                  Country
                  <select
                    value={bankCountry}
                    onChange={(event) => setBankCountry(event.target.value)}
                  >
                    <option value="AT">Austria</option>
                    <option value="DE">Germany</option>
                    <option value="FI">Finland</option>
                    <option value="GB">United Kingdom</option>
                    <option value="SE">Sweden</option>
                  </select>
                </label>
                <label>
                  Search banks
                  <input
                    value={bankSearch}
                    onChange={(event) => setBankSearch(event.target.value)}
                    placeholder="Bank name …"
                  />
                </label>
                <label>
                  Available banks
                  <select
                    required
                    value={bankName}
                    onChange={(event) => setBankName(event.target.value)}
                    disabled={banksLoading}
                  >
                    <option value="">{banksLoading ? "Loading banks …" : "Select a bank"}</option>
                    {banks
                      .filter((bank) => bank.name.toLowerCase().includes(bankSearch.toLowerCase()))
                      .map((bank) => (
                        <option
                          key={`${bank.country}:${bank.name}`}
                          value={bank.name}
                        >
                          {bank.name}
                          {bank.beta ? " (Beta)" : ""}
                        </option>
                      ))}
                  </select>
                </label>
                {!banksLoading && !banks.length && <p className="form-description">No personal bank is available for this country. Sandbox institutions can differ from production institutions.</p>}
                <button
                  className="button primary full-width"
                  disabled={busy || !bankName || banksLoading}
                >
                  Authorize with bank <ArrowRight size={16} />
                </button>
              </form>
            )}
            {modal === "account" && (
              <form
                onSubmit={(event) =>
                  submit(
                    event,
                    async (data) => {
                      await api("accounts", Object.fromEntries(data));
                    },
                    "Asset created.",
                  )
                }
              >
                <p className="form-description">Keep investment values and settlement cash separate to avoid counting the same assets twice.</p>
                <label>
                  Name
                  <input
                    name="name"
                    required
                    maxLength={100}
                    placeholder="e.g. Investment portfolio"
                  />
                </label>
                <div className="form-grid">
                  <label>
                    Institution
                    <input
                      name="institution"
                      required
                      maxLength={100}
                      placeholder="e.g. Example institution"
                    />
                  </label>
                  <label>
                    Type
                    <select name="kind">
                      {Object.entries(kinds).map(([key, label]) => (
                        <option
                          key={key}
                          value={key}
                        >
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="form-grid">
                  <label>
                    Current balance
                    <input
                      name="balance"
                      required
                      inputMode="decimal"
                      pattern="[+-]?[0-9]+([.][0-9]+)?"
                      placeholder="0.00"
                    />
                  </label>
                  <label>
                    Currency
                    <select name="currency">
                      <option>EUR</option>
                      <option>USD</option>
                      <option>CHF</option>
                      <option>GBP</option>
                    </select>
                  </label>
                </div>
                <p className="form-hint">Use a decimal point. Enter outstanding debt as a negative balance.</p>
                <button
                  className="button primary full-width"
                  disabled={busy}
                >
                  Create asset <Plus size={16} />
                </button>
              </form>
            )}
            {modal === "balance" && selectedAccount && (
              <form
                onSubmit={(event) =>
                  submit(
                    event,
                    async (data) => {
                      await api(`accounts/${selectedAccount.id}/balance`, Object.fromEntries(data));
                    },
                    "Balance saved.",
                  )
                }
              >
                <p className="form-description">
                  {selectedAccount.name} · {selectedAccount.currency}
                </p>
                <label>
                  New balance
                  <input
                    name="balance"
                    required
                    inputMode="decimal"
                    placeholder="0.00"
                  />
                </label>
                <label>
                  Valuation date
                  <input
                    name="date"
                    type="date"
                    required
                    defaultValue={new Date().toISOString().slice(0, 10)}
                    max={new Date().toISOString().slice(0, 10)}
                  />
                </label>
                <button
                  className="button primary full-width"
                  disabled={busy}
                >
                  Save balance <Check size={16} />
                </button>
              </form>
            )}
            {modal === "rule" && (
              <form
                onSubmit={(event) =>
                  submit(
                    event,
                    async (data) => {
                      await api("rules", { ...Object.fromEntries(data), priority: Number(data.get("priority")) });
                    },
                    "Rule created. New transactions will be categorized automatically.",
                  )
                }
              >
                <label>
                  Rule name
                  <input
                    name="name"
                    required
                    placeholder="e.g. Groceries"
                    maxLength={100}
                  />
                </label>
                <label>
                  Matching pattern
                  <input
                    name="pattern"
                    required
                    placeholder="e.g. MARKET"
                    maxLength={500}
                  />
                </label>
                <div className="form-grid">
                  <label>
                    Match type
                    <select name="mode">
                      <option value="keyword">Contains keyword</option>
                      <option value="regex">Regular expression (RE2)</option>
                    </select>
                  </label>
                  <label>
                    Priority
                    <input
                      name="priority"
                      type="number"
                      min="0"
                      max="10000"
                      defaultValue="100"
                      required
                    />
                  </label>
                </div>
                <label>
                  Category
                  <select
                    name="category_id"
                    required
                  >
                    {state?.categories.map((category) => (
                      <option
                        key={category.id}
                        value={category.id}
                      >
                        {category.name}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="form-hint">Matches the payee and description without case sensitivity. The first matching rule wins.</p>
                <button
                  className="button primary full-width"
                  disabled={busy}
                >
                  Create rule <Sparkles size={16} />
                </button>
              </form>
            )}
            {modal === "category" && (
              <form
                onSubmit={(event) =>
                  submit(
                    event,
                    async (data) => {
                      await api("categories", Object.fromEntries(data));
                    },
                    "Category created.",
                  )
                }
              >
                <label>
                  Name
                  <input
                    name="name"
                    required
                    maxLength={100}
                  />
                </label>
                <button
                  className="button primary full-width"
                  disabled={busy}
                >
                  Save category
                </button>
              </form>
            )}
            {modal === "import" && (
              <form
                onSubmit={(event) =>
                  submit(
                    event,
                    async (data) => {
                      const file = data.get("file") as File;
                      if (file.size > 1_000_000) throw new Error("The file cannot exceed 1 MB.");
                      const result = await api<{ message: string }>(`imports/${importMode}`, { account_id: data.get("account_id"), csv: await file.text() });
                      setNotice(result.message);
                    },
                    "CSV imported.",
                  )
                }
              >
                <p className="form-description">Import balances or booked transactions into a manual account. Files must use the format below; map bank exports to these columns first.</p>
                <label>
                  Import
                  <select
                    value={importMode}
                    onChange={(event) => setImportMode(event.target.value)}
                  >
                    <option value="balances">Investment / account balances</option>
                    <option value="transactions">Booked transactions</option>
                  </select>
                </label>
                <label>
                  Target account
                  <select
                    name="account_id"
                    required
                  >
                    <option value="">Select account</option>
                    {state?.accounts
                      .filter((account) => account.provider === "manual")
                      .map((account) => (
                        <option
                          key={account.id}
                          value={account.id}
                        >
                          {account.name} ({account.currency})
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  CSV file
                  <input
                    name="file"
                    type="file"
                    accept=".csv,text/csv"
                    required
                  />
                </label>
                <div className="csv-example">
                  <span>Expected format · comma or semicolon</span>
                  <pre>{importMode === "balances" ? "date;balance;currency\n2026-11-15;12500.00;EUR" : "id;date;amount;currency;counterparty;description\nentry-001;2026-11-15;-12.50;EUR;Supermarket;Purchase"}</pre>
                </div>
                <p className="form-hint">{importMode === "balances" ? "Multiple valuation dates are supported. The latest balance is used." : "IDs must be stable and unique within an account. Reimporting updates existing transactions. Update the account balance separately."}</p>
                <button
                  className="button primary full-width"
                  disabled={busy || !state?.accounts.some((account) => account.provider === "manual")}
                >
                  Import CSV <ArrowDownToLine size={16} />
                </button>
              </form>
            )}
          </div>
        </dialog>
      )}
    </div>
  );
}
