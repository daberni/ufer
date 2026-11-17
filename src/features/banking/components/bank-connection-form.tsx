"use client";

import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import { ArrowRight } from "lucide-react";
import { useId } from "react";
import { useDialogSubmit, type DialogFormProps } from "@/components/ui/use-dialog-submit";
import { useConnectBank } from "@/features/banking/mutations";
import { bankCountries } from "@/features/banking/bank-selection";
import { useBankDirectory } from "@/features/banking/use-bank-directory";
import type { Bank, Connection } from "@/features/banking/types";
import { FormError } from "@/components/ui/form-error";
import { TraceId } from "@/components/ui/trace-id";
import { SearchableSelect, type SearchableSelectOption } from "@/components/ui/searchable-select";
import { Select } from "@/components/ui/select";
import { Dialog } from "@/components/ui/dialog";
import { useBankingConfiguration } from "@/features/banking/banking-configuration";

type Props = DialogFormProps & {
  /** The connection to reauthorize; null connects a new bank. */
  connection: Connection | null;
};

const bankNoun = {
  one: "bank",
  other: "banks"
};

function bankOption(bank: Bank): SearchableSelectOption<string> {
  return {
    key: bank.name,
    value: bank.name,
    label: bank.name,
    description: bank.beta ? <span className={ui["pill"]}>Beta</span> : undefined
  };
}

function directoryStatus(directory: Pick<ReturnType<typeof useBankDirectory>, "banks" | "error" | "loading">) {
  if (directory.loading) {
    return {
      notice: "Loading banks …",
      placeholder: "Loading banks …"
    };
  }

  if (directory.error) {
    return {
      notice: "The bank list could not be loaded.",
      placeholder: "Bank list unavailable"
    };
  }

  if (!directory.banks.length) {
    return {
      notice: "No personal bank is available for this country.",
      placeholder: "No bank available"
    };
  }

  return {
    notice: "",
    placeholder: "Type to search banks"
  };
}

export function BankConnectionDialog({
  close,
  connection
}: Props) {
  return (
    <Dialog eyebrow="YOUR FINANCES" title="Connect bank" onClose={close}>
      <BankConnectionForm close={close} connection={connection} />
    </Dialog>
  );
}

function BankConnectionForm({
  close,
  connection
}: Props) {
  const { environment } = useBankingConfiguration();
  const directory = useBankDirectory(connection);
  const status = directoryStatus(directory);
  const bankFieldId = useId();
  const directoryErrorId = useId();
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
        <SearchableSelect
          id={bankFieldId}
          options={directory.banks.map(bankOption)}
          value={directory.bankName || undefined}
          onChange={directory.choose}
          query={directory.query}
          onQueryChange={directory.search}
          noun={bankNoun}
          placeholder={status.placeholder}
          notice={status.notice}
          busy={directory.loading}
          aria-describedby={directory.error ? directoryErrorId : undefined}
        />
        {directory.error && (
          <>
            <p id={directoryErrorId} className={ui["error-text"]}>{directory.error.message}</p>
            <TraceId id={directory.error.traceId} />
          </>
        )}
      </div>
      <FormError failure={error} />
      <button className={clsx(ui["button"], ui["primary"], ui["full-width"])} disabled={pending || !directory.bankName}>
        Authorize with bank <ArrowRight size={16} />
      </button>
    </form>
  );
}
