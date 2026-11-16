import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import { TriangleAlert } from "lucide-react";
import type { LegalConfiguration, OperatorDetails } from "../types";
import styles from "./operator-contact.module.css";

/** Warns that this installation has not published who operates it, so the page cannot serve as a registration URL. */
export function ConfigurationNotice({ configuration }: {
  configuration: LegalConfiguration
}) {
  if (configuration.configured) {
    return null;
  }

  return (
    <div className={clsx(ui["notice"], ui["warning"], styles["configuration-notice"])} role="note">
      <TriangleAlert size={18} />
      <p>
        <strong>Operator details are not configured.</strong> This installation has not provided the operator&apos;s identity, contact details and service providers, so this page is incomplete. The operator must set {configuration.invalidVariables.join(", ")}.
      </p>
    </div>
  );
}

export function OperatorContact({ operator }: {
  operator: OperatorDetails | null
}) {
  if (!operator) {
    return <p className={styles["missing"]}>Not configured for this installation.</p>;
  }

  return (
    <address className={styles["operator"]}>
      <strong>{operator.name}</strong>
      {operator.addressLines.map(line => <span key={line}>{line}</span>)}
      <a href={`mailto:${operator.email}`}>{operator.email}</a>
    </address>
  );
}
