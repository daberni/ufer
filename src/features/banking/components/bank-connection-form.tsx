"use client";

import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import { ArrowRight } from "lucide-react";
import { useId } from "react";
import { useDialogSubmit, type DialogFormProps } from "@/features/dashboard/use-dialog-submit";
import { useConnectBank } from "@/features/banking/mutations";
import { bankCountries } from "@/features/banking/bank-selection";
import { useBankDirectory } from "@/features/banking/use-bank-directory";
import type { Connection } from "@/features/dashboard/types";
import { FormError } from "@/components/ui/form-error";
import { Select } from "@/components/ui/select";
import { BankPicker } from "./bank-picker";

type Props = DialogFormProps & {
  environment: string;
  /** The connection to reauthorize; null connects a new bank. */
  connection: Connection | null;
};

export function BankConnectionForm({
  close,
  connection,
  environment
}: Props) {
  const directory = useBankDirectory(connection);
  const bankFieldId = useId();
  const {
    error,
    pending,
    submit
  } = useDialogSubmit(useConnectBank(), close);

  return (
    <form
      onSubmit={event => submit(event, () => ({
        bank: directory.bankName,
        country: directory.country
      }))}
      className={ui["form"]}
    >
      <p className={ui["form-description"]}>{environment === "SANDBOX" ? "You are connecting a test bank. Use only its test credentials." : "After selecting a bank, authorize read-only access with your bank."}</p>
      <label>
        Country
        <Select value={directory.country} onChange={event => directory.setCountry(event.target.value)}>
          {bankCountries.map(country => <option key={country.code} value={country.code}>{country.name}</option>)}
        </Select>
      </label>
      <div className={ui["field"]}>
        <label htmlFor={bankFieldId}>Bank</label>
        <BankPicker
          id={bankFieldId}
          banks={directory.banks}
          query={directory.query}
          bankName={directory.bankName}
          loading={directory.loading}
          error={directory.error}
          onSearch={directory.search}
          onChoose={directory.choose}
        />
      </div>
      <FormError message={error} />
      <button className={clsx(ui["button"], ui["primary"], ui["full-width"])} disabled={pending || !directory.bankName}>
        Authorize with bank <ArrowRight size={16} />
      </button>
    </form>
  );
}
