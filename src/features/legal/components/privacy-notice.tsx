import { useTranslations } from "next-intl";
import type { DataProcessor, LegalConfiguration } from "../types";
import { LegalDocument } from "./legal-document";
import { ConfigurationNotice, OperatorContact } from "./operator-contact";

// Change this date whenever the text below changes.
const lastUpdated = "2026-11-22";

const code = (chunks: React.ReactNode) => <code>{chunks}</code>;
const strong = (chunks: React.ReactNode) => <strong>{chunks}</strong>;

export function PrivacyNotice({ configuration }: {
  configuration: LegalConfiguration
}) {
  const t = useTranslations("legal.privacy");
  const operator = configuration.configured ? configuration.operator : null;
  const processors = configuration.configured ? configuration.processors : null;
  const email = operator?.email;

  return (
    <LegalDocument title={t("title")} lastUpdated={lastUpdated}>
      <ConfigurationNotice configuration={configuration} />
      <p>{t("intro")}</p>

      <h2>{t("responsible.heading")}</h2>
      <p>{t("responsible.body")}</p>
      <OperatorContact operator={operator} />

      <h2>{t("installation.heading")}</h2>
      <p>{t("installation.basis")}</p>
      <p>{t("installation.shared")}</p>

      <h2>{t("data.heading")}</h2>
      <h3>{t("data.account.heading")}</h3>
      <p>{t("data.account.body")}</p>
      <h3>{t("data.sessions.heading")}</h3>
      <p>{t("data.sessions.body")}</p>
      <h3>{t("data.bank.heading")}</h3>
      <p>{t("data.bank.intro")}</p>
      <ul>
        <li>{t("data.bank.bankName")}</li>
        <li>{t("data.bank.accounts")}</li>
        <li>{t("data.bank.transactions")}</li>
        <li>{t("data.bank.foreignCurrency")}</li>
        <li>{t("data.bank.rawRecord")}</li>
        <li>{t("data.bank.accountIdentifier")}</li>
        <li>{t("data.bank.sessionId")}</li>
        <li>{t("data.bank.connections")}</li>
        <li>{t("data.bank.history")}</li>
      </ul>
      <p>{t("data.bank.sync")}</p>
      <h3>{t("data.entered.heading")}</h3>
      <p>{t("data.entered.body")}</p>
      <h3>{t("data.required.heading")}</h3>
      <p>{t("data.required.body")}</p>
      <h3>{t("data.logs.heading")}</h3>
      <p>{t("data.logs.body")}</p>
      <h3>{t("data.cookies.heading")}</h3>
      <p>{t("data.cookies.intro")}</p>
      <ul>
        <li>
          {t.rich("data.cookies.session", {
            code
          })}
        </li>
        <li>
          {t.rich("data.cookies.bankFlow", {
            code
          })}
        </li>
      </ul>
      <p>{t("data.cookies.noTracking")}</p>

      <h2>{t("purposes.heading")}</h2>
      <ul>
        <li>{t("purposes.service")}</li>
        <li>{t("purposes.security")}</li>
        <li>{t("purposes.thirdParties")}</li>
      </ul>
      <p>{t("purposes.authorization")}</p>

      <h2>{t("recipients.heading")}</h2>
      <ul>
        <li>
          {t.rich("recipients.enableBanking", {
            strong
          })}
        </li>
        <ProcessorItems processors={processors} />
      </ul>
      <p>{t("recipients.others")}</p>

      <h2>{t("security.heading")}</h2>
      <p>{t("security.body")}</p>

      <h2>{t("retention.heading")}</h2>
      <ul>
        <li>{t("retention.account")}</li>
        <li>{t("retention.sessions")}</li>
        <li>{t("retention.connections")}</li>
        <li>{t("retention.onRequest")}</li>
        <li>{t("retention.logs")}</li>
        <li>{t("retention.backups")}</li>
      </ul>

      <h2>{t("rights.heading")}</h2>
      <p>
        {email ? t.rich("rights.exerciseWithEmail", {
          email,
          mail: chunks => <a href={`mailto:${email}`}>{chunks}</a>
        }) : t("rights.exerciseWithoutEmail")}
      </p>
      <p>{t("rights.responseTime")}</p>
      <p>{t("rights.withdrawal")}</p>
      <p>{t("rights.automatedDecisions")}</p>

      <h3>{t("rights.objectHeading")}</h3>
      <p>{t("rights.object")}</p>

      <h2>{t("changes.heading")}</h2>
      <p>{t("changes.body")}</p>
    </LegalDocument>
  );
}

function ProcessorItems({ processors }: {
  processors: DataProcessor[] | null
}) {
  const t = useTranslations("legal.privacy.recipients");

  if (!processors) {
    return <li>{t("processorsMissing")}</li>;
  }

  if (processors.length === 0) {
    return <li>{t("processorsNone")}</li>;
  }

  return processors.map(processor => (
    <li key={processor.name}>
      {t.rich("processor", {
        name: processor.name,
        location: processor.location,
        purpose: processor.purpose,
        strong
      })}
    </li>
  ));
}
