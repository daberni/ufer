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
        <strong>Operator details are not configured.</strong> This installation has not provided the operator&apos;s identity and service providers, so this page is incomplete. The operator must set {configuration.invalidVariables.join(", ")}.
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
      <span>{operator.residence}</span>
      {operator.email && <a href={`mailto:${operator.email}`}>{operator.email}</a>}
    </address>
  );
}

/** How to reach the operator; without a published email, only the personal channel every invited user already has is true for this installation. */
export function ContactInstructions({ operator }: {
  operator: OperatorDetails | null
}) {
  if (operator?.email) {
    return <>contact the operator at <a href={`mailto:${operator.email}`}>{operator.email}</a></>;
  }

  return <>contact the operator directly, the same way you were given access to this installation; no contact email is published for it</>;
}
