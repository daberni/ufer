"use client";

import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import { ArrowRight } from "lucide-react";
import { api } from "@/client/api";
import type { DashboardController } from "@/features/dashboard/use-dashboard";

type Props = Pick<DashboardController, "bankCountry" | "bankName" | "bankSearch" | "banks" | "banksLoading" | "busy" | "setBankCountry" | "setBankName" | "setBankSearch" | "state" | "submit">;

export function BankConnectionForm({
  bankCountry,
  bankName,
  bankSearch,
  banks,
  banksLoading,
  busy,
  setBankCountry,
  setBankName,
  setBankSearch,
  state,
  submit
}: Props) {
  if (!state) {
    return null;
  }

  return (
    <form
      onSubmit={event => submit(event, async () => {
        const result = await api<{
          url: string;
        }>("banking/connect", {
          bank: bankName,
          country: bankCountry
        });

        window.location.assign(result.url);
      }, "")}
      className={ui["form"]}
    >
      <p className={ui["form-description"]}>{state?.environment === "SANDBOX" ? "You are connecting a test bank. Use only its sandbox credentials." : "After selecting a bank, authorize read-only access with your bank."}</p>
      <label>
        Country
        <select value={bankCountry} onChange={event => setBankCountry(event.target.value)}>
          <option value="AT">Austria</option>
          <option value="DE">Germany</option>
          <option value="FI">Finland</option>
          <option value="GB">United Kingdom</option>
          <option value="SE">Sweden</option>
        </select>
      </label>
      <label>
        Search banks
        <input value={bankSearch} onChange={event => setBankSearch(event.target.value)} placeholder="Bank name …" />
      </label>
      <label>
        Available banks
        <select
          required
          value={bankName}
          onChange={event => setBankName(event.target.value)}
          disabled={banksLoading}
        >
          <option value="">{banksLoading ? "Loading banks …" : "Select a bank"}</option>
          {banks.filter(bank => bank.name.toLowerCase().includes(bankSearch.toLowerCase())).map(bank => (
            <option key={`${bank.country}:${bank.name}`} value={bank.name}>
              {bank.name}
              {bank.beta ? " (Beta)" : ""}
            </option>
          ))}
        </select>
      </label>
      {!banksLoading && !banks.length && <p className={ui["form-description"]}>No personal bank is available for this country. Sandbox institutions can differ from production institutions.</p>}
      <button className={clsx(ui["button"], ui["primary"], ui["full-width"])} disabled={busy || !bankName || banksLoading}>
        Authorize with bank <ArrowRight size={16} />
      </button>
    </form>
  );
}
