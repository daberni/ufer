import type { DataProcessor, LegalConfiguration } from "../types";
import { LegalDocument } from "./legal-document";
import { ConfigurationNotice, ContactInstructions, OperatorContact } from "./operator-contact";

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
        <li>
          where the bank provides them, further transaction details: value and transaction dates, the bank&apos;s transaction code, the merchant category code, exchange rate and original amount and currency, the balance after the transaction, the payment reference number, and the counterparty&apos;s IBAN or other account number and bank identifier (BIC);
        </li>
        <li>
          the complete transaction record as the bank delivered it, so that these details can be evaluated again later; depending on the bank it can also contain your own account identifiers and the counterparty&apos;s address or other identifiers;
        </li>
        <li>an account identifier provided by Enable Banking, used to recognize accounts when you reconnect;</li>
        <li>the Enable Banking session ID, encrypted;</li>
        <li>a record of each bank connection with the bank&apos;s name and country, its status, the user who started it and when;</li>
        <li>a synchronization history with times, numbers of imported transactions and errors.</li>
      </ul>
      <p>
        Synchronization runs when a user selects Sync and once a day automatically, and covers the last 89 days. Ufer only reads account information and cannot initiate payments. You sign in to your bank directly; your bank credentials never reach Ufer. Transactions can contain personal data of other people, such as the names, account numbers and addresses of payers and payees and payment references.
      </p>
      <h3>Data you enter or import</h3>
      <p>
        Manual accounts and valuations, balances and transactions imported from CSV files into manual accounts, categories, categorization rules and category assignments. Ufer stores the imported rows, not the uploaded file.
      </p>
      <h3>What you need to provide</h3>
      <p>
        To have a user account, the operator needs your username, display name and email address, and you need a password; without them you cannot use Ufer. Connecting a bank is optional and only needed for bank synchronization. Manual accounts, valuations and imports are optional too; without them the related features stay empty. There is no legal obligation to provide data.
      </p>
      <h3>Technical logs</h3>
      <p>
        When a request fails, the server logs a trace ID, the status code and the error type so that support requests can be matched to an error. These entries do not contain request contents or financial data. The infrastructure that runs Ufer also processes connection data to deliver requests and may keep its own request logs, including the requested URL, the browser&apos;s user-agent string and the IP address.
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

      <h2>Security</h2>
      <p>
        Passwords are hashed, session cookies are HttpOnly and, on HTTPS, Secure, and Enable Banking session IDs are encrypted with AES-256-GCM. Financial data is not end-to-end encrypted: the operator and the providers that store the database can technically access it.
      </p>

      <h2>Retention and deletion</h2>
      <ul>
        <li>Your user account data is kept while you have access to this installation. The operator deletes it when your access ends or when you ask for deletion.</li>
        <li>
          A session record, including its user-agent string, is deleted when you sign out. Changing your password or choosing to sign out other devices deletes the records of your other sessions and keeps the current one. A session that expires without a sign-out keeps its record in the database until the operator removes it.
        </li>
        <li>
          Removing a bank connection under Bank connections deletes the encrypted Enable Banking session ID and asks Enable Banking to end the session. If that request fails, the authorization ends when it expires or when you withdraw it at your bank. The connection record stays without the session ID. Accounts, balances and transactions retrieved before the removal remain in the shared workspace until the operator deletes them on request or deletes the installation&apos;s database when the installation is discontinued.
        </li>
        <li>
          Ufer does not yet offer self-service deletion of user accounts or financial data. The operator deletes them on request within the response times below and confirms the deletion. Because all users share one workspace, the operator may ask which accounts a request covers.
        </li>
        <li>
          Error log entries and request logs are kept for the log retention period of the hosting infrastructure. Where a hosting provider is listed above, its entry states that period.
        </li>
        <li>Deleted data can remain in backups kept by the database provider until they expire under that provider&apos;s backup retention.</li>
      </ul>

      <h2>Your rights</h2>
      <p>
        You have the right to access your personal data, to have it rectified or erased, to restrict its processing and to receive it in a portable format. To exercise these rights, <ContactInstructions operator={operator} />.
      </p>
      <p>
        The operator answers without undue delay and at the latest within one month of receiving your request. Where necessary because of the complexity or number of requests, this can be extended by two further months; you will be told about the extension and the reasons within the first month.
      </p>
      <p>
        You can withdraw a bank authorization at any time by removing the connection in Ufer or at your bank. You can also lodge a complaint with a data protection supervisory authority, in particular in the EU member state of your habitual residence, place of work or the place of the alleged infringement.
      </p>
      <p>
        Ufer does not make automated decisions that have legal or similarly significant effects on you.
      </p>

      <h3>Right to object</h3>
      <p>
        Where processing is based on legitimate interests (Art. 6(1)(f) GDPR), you can object to it at any time on grounds relating to your particular situation. The operator then stops that processing unless there are compelling legitimate grounds that override your interests, rights and freedoms, or the processing is needed to establish, exercise or defend legal claims.
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
