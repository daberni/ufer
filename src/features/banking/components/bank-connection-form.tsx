"use client";

import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import { ArrowRight } from "lucide-react";
import { useId } from "react";
import { useDialogSubmit, type DialogFormProps } from "@/components/ui/use-dialog-submit";
import { useConnectBank } from "@/features/banking/mutations";
import { namedCountries } from "@/features/banking/bank-selection";
import { useBankDirectory } from "@/features/banking/use-bank-directory";
import type { Bank, Connection } from "@/features/banking/types";
import type { Account } from "@/features/accounts/types";
import { FormError } from "@/components/ui/form-error";
import { TraceId } from "@/components/ui/trace-id";
import { SearchableSelect, type SearchableSelectOption } from "@/components/ui/searchable-select";
import { Select } from "@/components/ui/select";
import { Dialog } from "@/components/ui/dialog";
import { useBankingConfiguration } from "@/features/banking/banking-configuration";
import { useLocale, useTranslations } from "next-intl";

type ConnectMessages = ReturnType<typeof useTranslations<"banking.connect">>;

type Props = DialogFormProps & {
  /** The connection to reauthorize; null connects a new bank. */
  connection: Connection | null;
  /** The manual account to connect to one of the authorized bank accounts. */
  account?: Pick<Account, "id" | "name">;
};

function bankOption(bank: Bank, betaLabel: string): SearchableSelectOption<string> {
  return {
    key: bank.name,
    value: bank.name,
    label: bank.name,
    description: bank.beta ? <span className={ui["pill"]}>{betaLabel}</span> : undefined
  };
}

function directoryStatus(directory: Pick<ReturnType<typeof useBankDirectory>, "banks" | "error" | "loading">, t: ConnectMessages) {
  if (directory.loading) {
    return {
      notice: t("loadingBanks"),
      placeholder: t("loadingBanks")
    };
  }

  if (directory.error) {
    return {
      notice: t("directoryFailed"),
      placeholder: t("directoryUnavailable")
    };
  }

  if (!directory.banks.length) {
    return {
      notice: t("noBankNotice"),
      placeholder: t("noBankPlaceholder")
    };
  }

  return {
    notice: "",
    placeholder: t("searchPlaceholder")
  };
}

export function BankConnectionDialog({
  close,
  connection,
  account
}: Props) {
  const t = useTranslations("banking");

  return (
    <Dialog eyebrow={t("eyebrow")} title={account ? t("connect.titleAccount") : t("connect.titleNew")} onClose={close}>
      <BankConnectionForm close={close} connection={connection} account={account} />
    </Dialog>
  );
}

function BankConnectionForm({
  close,
  connection,
  account
}: Props) {
  const t = useTranslations("banking.connect");
  const common = useTranslations("common");
  const locale = useLocale();
  const { environment } = useBankingConfiguration();
  const directory = useBankDirectory(connection);
  // Country names come from the runtime in the interface language, so no catalog has to list them.
  const countries = namedCountries(directory.countries, locale);
  const status = directoryStatus(directory, t);
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
        country: directory.country ?? "",
        ...(account ? {
          accountId: account.id
        } : {})
      }))}
      className={ui["form"]}
    >
      <p className={ui["form-description"]}>{environment === "SANDBOX" ? t("sandboxDescription") : t("description")}</p>
      {account && (
        <p className={ui["form-hint"]}>{t("accountHint", {
          account: account.name
        })}</p>
      )}
      <label>
        {t("country")}
        <Select value={directory.country ?? ""} disabled={!countries.length} onChange={event => directory.setCountry(event.target.value)}>
          {countries.map(country => <option key={country.code} value={country.code}>{country.name}</option>)}
        </Select>
      </label>
      <div className={ui["field"]}>
        <label htmlFor={bankFieldId}>{t("bank")}</label>
        <SearchableSelect
          id={bankFieldId}
          options={directory.banks.map(bank => bankOption(bank, t("beta")))}
          value={directory.bankName || undefined}
          onChange={directory.choose}
          query={directory.query}
          onQueryChange={directory.search}
          noun="bank"
          placeholder={status.placeholder}
          notice={status.notice}
          busy={directory.loading}
          aria-describedby={directory.error ? directoryErrorId : undefined}
        />
        {directory.error && (
          <>
            <p id={directoryErrorId} className={ui["error-text"]}>{t("directoryFailedRetry")}</p>
            <TraceId id={directory.error.traceId} />
            <button className={ui["text-button"]} type="button" onClick={directory.retry}>{common("retry")}</button>
          </>
        )}
      </div>
      <FormError failure={error} />
      <button className={clsx(ui["button"], ui["primary"], ui["full-width"])} disabled={pending || !directory.bankName}>
        {t("authorize")} <ArrowRight size={16} />
      </button>
    </form>
  );
}
