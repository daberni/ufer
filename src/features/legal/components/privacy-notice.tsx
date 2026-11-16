import type { DataProcessor, LegalConfiguration } from "../types";
import { LegalDocument } from "./legal-document";
import { ConfigurationNotice, OperatorContact } from "./operator-contact";

// Change this date whenever the text below changes.
const lastUpdated = "2026-11-16";

export function PrivacyNotice({ configuration }: {
  configuration: LegalConfiguration
}) {
  const operator = configuration.configured ? configuration.operator : null;
  const processors = configuration.configured ? configuration.processors : null;

  return (
    <LegalDocument title="Privacy notice" lastUpdated={lastUpdated}>
      <ConfigurationNotice configuration={configuration} />
      <p>
        This notice explains which personal data this Ufer installation processes, why, and what rights you have under the EU General Data Protection Regulation (GDPR).
      </p>

      <h2>Who is responsible</h2>
      <p>The operator of this installation is the controller for the processing described here:</p>
      <OperatorContact operator={operator} />

      <h2>About this installation</h2>
      <p>
        Ufer is an early-stage overview of personal finances. This installation is operated on a non-commercial basis for users the operator has invited; there is no public registration.
      </p>
      <p>
        All users of this installation share one financial workspace. Every signed-in user can see and change all accounts, transactions, categories and rules, including bank data connected by another user.
      </p>

      <h2>Data processed</h2>
      <h3>Your user account</h3>
      <p>
        Your username, display name and email address, which the operator enters when enrolling you, your role, and your password, which is stored only in hashed form. Email addresses are not verified and Ufer does not send emails.
      </p>
      <h3>Sign-in and sessions</h3>
      <p>
        When you sign in, Ufer stores a session record with its expiry time and your browser&apos;s user-agent string. Ufer does not store your IP address with the session. Sign-in attempts are counted per endpoint, not per person, to limit password guessing.
      </p>
      <h3>Bank data</h3>
      <p>
        When you connect a bank, Enable Banking retrieves account information from your bank with your authorization. Ufer then stores:
      </p>
      <ul>
        <li>the bank&apos;s name and country and how long your authorization is valid;</li>
        <li>account names, IBANs, currencies, balances and balance history;</li>
        <li>booked transactions with date, amount, currency, counterparty name and description;</li>
        <li>an account identifier provided by Enable Banking, used to recognize accounts when you reconnect;</li>
        <li>the Enable Banking session ID, encrypted;</li>
        <li>a synchronization history with times, numbers of imported transactions and errors.</li>
      </ul>
      <p>
        Synchronization runs when a user selects Sync and once a day automatically, and covers the last 89 days. Ufer only reads account information and cannot initiate payments. You sign in to your bank directly; your bank credentials never reach Ufer. Transactions can contain personal data of other people, such as the names of payers and payees and payment references.
      </p>
      <h3>Data you enter or import</h3>
      <p>
        Manual accounts and valuations, balances and transactions imported from CSV files into manual accounts, categories, categorization rules and category assignments. Ufer stores the imported rows, not the uploaded file.
      </p>
      <h3>Technical logs</h3>
      <p>
        When a request fails, the server logs a trace ID, the status code and the error type so that support requests can be matched to an error. These entries do not contain request contents or financial data. The infrastructure that runs Ufer also processes connection data such as IP addresses to deliver requests, and may keep its own request logs.
      </p>
      <h3>Cookies</h3>
      <p>Ufer uses only cookies that are necessary to provide the service:</p>
      <ul>
        <li>
          <code>better-auth.session_token</code> (named <code>__Secure-better-auth.session_token</code> on HTTPS) keeps you signed in. It is valid for up to seven days, is renewed while you use Ufer and ends when you sign out.
        </li>
        <li>
          <code>budget_bank_flow</code> links a bank authorization to the browser that started it. It is sent only to the bank callback, expires after 15 minutes and is deleted when the authorization completes.
        </li>
      </ul>
      <p>
        There is no analytics, advertising or tracking. The pages do not load third-party scripts or fonts.
      </p>

      <h2>Purposes and legal bases</h2>
      <ul>
        <li>Providing the service you use, including your user account, bank synchronization and the financial overview: performance of a contract (Art. 6(1)(b) GDPR).</li>
        <li>Keeping the service secure and reliable through sessions, sign-in limits, error logs and encryption: legitimate interests (Art. 6(1)(f) GDPR).</li>
        <li>Personal data of other people contained in transactions: the legitimate interest of users in a complete overview of their own finances (Art. 6(1)(f) GDPR).</li>
      </ul>
      <p>
        Bank access additionally requires your authorization in the Enable Banking and bank flow. You can withdraw it at any time, as described below.
      </p>

      <h2>Service providers and recipients</h2>
      <ul>
        <li>
          <strong>Enable Banking</strong> connects to your bank and transmits account information to Ufer. During authorization, Enable Banking and your bank present their own terms and privacy information, which govern their processing.
        </li>
        <ProcessorItems processors={processors} />
      </ul>
      <p>
        Other users of this installation can see the shared financial data. Data is not sold or used for advertising.
      </p>
      {processors && processors.length > 0 && (
        <p>
          Where a provider processes data outside the European Economic Area, the transfer relies on the safeguards in that provider&apos;s data processing terms.
        </p>
      )}

      <h2>Security</h2>
      <p>
        Passwords are hashed, session cookies are HttpOnly and, on HTTPS, Secure, and Enable Banking session IDs are encrypted with AES-256-GCM. Financial data is not end-to-end encrypted: the operator and the providers that store the database can technically access it.
      </p>

      <h2>Retention and deletion</h2>
      <ul>
        <li>Your user account data is kept as long as you have access to this installation.</li>
        <li>Sessions end when you sign out or when they expire.</li>
        <li>
          Removing a bank connection under Bank connections deletes the encrypted Enable Banking session ID and asks Enable Banking to end the session. If that request fails, the authorization ends when it expires or when you withdraw it at your bank. Accounts, balances and transactions retrieved before the removal are kept until they are deleted.
        </li>
        <li>
          Ufer does not yet offer self-service deletion of user accounts or financial data. The operator deletes them on request.
        </li>
        <li>Technical logs are kept for the retention period of the infrastructure that produces them.</li>
        <li>Deleted data can remain in database backups until those backups expire.</li>
      </ul>

      <h2>Your rights</h2>
      <p>
        You have the right to access your personal data, to have it rectified or erased, to restrict its processing, to receive it in a portable format and to object to processing based on legitimate interests. To exercise these rights, contact the operator using the details above; requests are answered within one month.
      </p>
      <p>
        You can withdraw a bank authorization at any time by removing the connection in Ufer or at your bank. You can also lodge a complaint with a data protection supervisory authority, in particular in the EU member state of your habitual residence, place of work or the place of the alleged infringement.
      </p>
      <p>
        Ufer does not make automated decisions that have legal or similarly significant effects on you.
      </p>

      <h2>Changes</h2>
      <p>
        This notice is updated when the processing changes. The date at the top shows the current version.
      </p>
    </LegalDocument>
  );
}

function ProcessorItems({ processors }: {
  processors: DataProcessor[] | null
}) {
  if (!processors) {
    return <li>Hosting and database providers: not configured for this installation.</li>;
  }

  if (processors.length === 0) {
    return <li>This installation does not use external hosting or database providers; the operator runs it on infrastructure under their own control.</li>;
  }

  return processors.map(processor => (
    <li key={processor.name}>
      <strong>{processor.name}</strong> ({processor.location}): {processor.purpose}
    </li>
  ));
}
