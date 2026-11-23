import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import { TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import type { LegalConfiguration, OperatorDetails } from "../types";
import styles from "./operator-contact.module.css";

/** Warns that this installation has not published who operates it, so the page cannot serve as a registration URL. */
export function ConfigurationNotice({ configuration }: {
  configuration: LegalConfiguration
}) {
  const t = useTranslations("legal.operator");

  if (configuration.configured) {
    return null;
  }

  return (
    <div className={clsx(ui["notice"], ui["warning"], styles["configuration-notice"])} role="note">
      <TriangleAlert size={18} />
      <p>
        {t.rich("notConfigured", {
          variables: configuration.invalidVariables.join(", "),
          strong: chunks => <strong>{chunks}</strong>
        })}
      </p>
    </div>
  );
}

export function OperatorContact({ operator }: {
  operator: OperatorDetails | null
}) {
  const t = useTranslations("legal.operator");

  if (!operator) {
    return <p className={styles["missing"]}>{t("missing")}</p>;
  }

  return (
    <address className={styles["operator"]}>
      <strong>{operator.name}</strong>
      <span>{operator.residence}</span>
      {operator.email && <a href={`mailto:${operator.email}`}>{operator.email}</a>}
    </address>
  );
}

