import Link from "next/link";
import { useTranslations } from "next-intl";
import type { LegalConfiguration } from "../types";
import { LegalDocument } from "./legal-document";
import { ConfigurationNotice, OperatorContact } from "./operator-contact";

// Change this date whenever the text below changes.
const lastUpdated = "2026-11-22";

export function TermsOfUse({ configuration }: {
  configuration: LegalConfiguration
}) {
  const t = useTranslations("legal.terms");
  const operator = configuration.configured ? configuration.operator : null;

  return (
    <LegalDocument title={t("title")} lastUpdated={lastUpdated}>
      <ConfigurationNotice configuration={configuration} />
      <p>
        {t.rich("intro", {
          privacy: chunks => <Link href="/privacy">{chunks}</Link>
        })}
      </p>

      <h2>{t("operator.heading")}</h2>
      <p>{t("operator.intro")}</p>
      <OperatorContact operator={operator} />
      <p>{t("operator.scope")}</p>

      <h2>{t("service.heading")}</h2>
      <p>{t("service.body")}</p>
      <p>{t("service.shared")}</p>

      <h2>{t("bank.heading")}</h2>
      <p>{t("bank.body")}</p>

      <h2>{t("responsibilities.heading")}</h2>
      <ul>
        <li>{t("responsibilities.entitled")}</li>
        <li>{t("responsibilities.password")}</li>
        <li>{t("responsibilities.misuse")}</li>
        <li>{t("responsibilities.security")}</li>
      </ul>

      <h2>{t("advice.heading")}</h2>
      <p>{t("advice.body")}</p>

      <h2>{t("accuracy.heading")}</h2>
      <p>{t("accuracy.body")}</p>

      <h2>{t("availability.heading")}</h2>
      <p>{t("availability.body")}</p>

      <h2>{t("ending.heading")}</h2>
      <p>{t("ending.body")}</p>

      <h2>{t("liability.heading")}</h2>
      <p>{t("liability.body")}</p>

      <h2>{t("changes.heading")}</h2>
      <p>{t("changes.body")}</p>

      <h2>{t("law.heading")}</h2>
      <p>{t("law.body")}</p>
    </LegalDocument>
  );
}
