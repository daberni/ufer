"use client";

import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import { ArrowRight } from "lucide-react";
import type { DashboardController } from "@/features/dashboard/use-dashboard";
import { useDialogSubmit, type DialogFormProps } from "@/features/dashboard/use-dialog-submit";
import { useConnectBank } from "@/features/banking/mutations";
import { FormError } from "@/components/ui/form-error";
import { Select } from "@/components/ui/select";

type Props = Pick<DashboardController, "bankCountry" | "bankName" | "bankSearch" | "banks" | "banksError" | "banksLoading" | "setBankCountry" | "setBankName" | "setBankSearch"> & DialogFormProps & {
  environment: string;
};

export function BankConnectionForm({
  bankCountry,
  bankName,
  bankSearch,
  banks,
  banksError,
  banksLoading,
  close,
  environment,
  setBankCountry,
  setBankName,
  setBankSearch
}: Props) {
  const {
    error,
    pending,
    submit
  } = useDialogSubmit(useConnectBank(), close);

  return (
    <form
      onSubmit={event => submit(event, () => ({
        bank: bankName,
        country: bankCountry
      }))}
      className={ui["form"]}
    >
      <p className={ui["form-description"]}>{environment === "SANDBOX" ? "You are connecting a test bank. Use only its sandbox credentials." : "After selecting a bank, authorize read-only access with your bank."}</p>
      <label>
        Country
        <Select value={bankCountry} onChange={event => setBankCountry(event.target.value)}>
          <option value="AT">Austria</option>
          <option value="DE">Germany</option>
          <option value="FI">Finland</option>
          <option value="GB">United Kingdom</option>
          <option value="SE">Sweden</option>
        </Select>
      </label>
      <label>
        Search banks
        <input value={bankSearch} onChange={event => setBankSearch(event.target.value)} placeholder="Bank name …" />
      </label>
      <label>
        Available banks
        <Select
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
        </Select>
      </label>
      {!banksLoading && !banksError && !banks.length && <p className={ui["form-description"]}>No personal bank is available for this country. Sandbox institutions can differ from production institutions.</p>}
      <FormError message={banksError || error} />
      <button className={clsx(ui["button"], ui["primary"], ui["full-width"])} disabled={pending || !bankName || banksLoading}>
        Authorize with bank <ArrowRight size={16} />
      </button>
    </form>
  );
}
