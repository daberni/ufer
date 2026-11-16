import Link from "next/link";
import type { LegalConfiguration } from "../types";
import { LegalDocument } from "./legal-document";
import { ConfigurationNotice, OperatorContact } from "./operator-contact";

// Change this date whenever the text below changes.
const lastUpdated = "2026-11-16";

export function TermsOfUse({ configuration }: {
  configuration: LegalConfiguration
}) {
  const operator = configuration.configured ? configuration.operator : null;

  return (
    <LegalDocument title="Terms of use" lastUpdated={lastUpdated}>
      <ConfigurationNotice configuration={configuration} />
      <p>
        These terms apply to your use of this Ufer installation. By signing in, you accept them. The <Link href="/privacy">privacy notice</Link> explains how your data is processed.
      </p>

      <h2>Operator and scope</h2>
      <p>This installation is operated by:</p>
      <OperatorContact operator={operator} />
      <p>
        Ufer is in early development. This installation is a personal, non-commercial installation available only to users the operator has invited and enrolled. It is not a commercial service: there is no public registration, no paid plan and no fee.
      </p>

      <h2>The service</h2>
      <p>
        Ufer shows an overview of accounts, balances, transactions and spending. It can retrieve account information from banks through Enable Banking, and you can add manual accounts, valuations and CSV imports. Ufer only reads account information and cannot initiate payments.
      </p>
      <p>
        All users of this installation share one financial workspace and can see and change all of its data, including bank data connected by another user.
      </p>

      <h2>Bank connections</h2>
      <p>
        To connect a bank, you are redirected to Enable Banking and your bank, where you authorize access to your account information. Their own terms apply to that step. The authorization lasts for the period your bank grants. You can end it at any time by removing the connection in Ufer or at your bank.
      </p>

      <h2>Your responsibilities</h2>
      <ul>
        <li>Connect or import only accounts you are entitled to access, and share them only with users you have agreed to share them with.</li>
        <li>Keep your Ufer password confidential and do not share your user account.</li>
        <li>Tell the operator promptly if you suspect misuse of your account.</li>
        <li>Do not try to bypass security measures, access data without authorization or disrupt the service.</li>
      </ul>

      <h2>No financial advice</h2>
      <p>
        Ufer presents information about your finances. It does not provide financial, investment, tax or legal advice.
      </p>

      <h2>Accuracy of data</h2>
      <p>
        Bank data depends on your bank and Enable Banking and can be delayed, incomplete or incorrect. Imported and manually entered data is only as accurate as its source. Check important figures with your bank before relying on them, and do not use Ufer as your only record of your finances.
      </p>

      <h2>Availability and changes</h2>
      <p>
        The service is provided free of charge and as it is, without any guarantee of availability. Features can change or be removed, and the service can be interrupted for maintenance or other reasons.
      </p>

      <h2>Ending use</h2>
      <p>
        You can stop using Ufer at any time and ask the operator to remove your access and delete your data. The operator can suspend or end your access, for example in case of misuse or if this installation is discontinued, and will give reasonable notice where possible.
      </p>

      <h2>Liability</h2>
      <p>
        Because the service is free of charge and provided without guarantee, the operator is liable only for intent and gross negligence, to the extent permitted by applicable law. This does not limit liability for injury to life, body or health or any liability that cannot be excluded by law.
      </p>

      <h2>Changes to these terms</h2>
      <p>
        The operator can update these terms and will inform users of material changes. The date at the top shows the current version.
      </p>

      <h2>Applicable law</h2>
      <p>
        These terms are governed by the law of the country in which the operator is established, excluding its conflict-of-law rules. Mandatory consumer protection provisions of your country of residence remain unaffected.
      </p>
    </LegalDocument>
  );
}
