-- Accounts no longer store an institution: a bank-linked account names its bank through its connection's bank_name, and manual accounts, detached bank accounts and accounts created by a CSV import have none.
-- Every stored institution, including user-entered ones on manual accounts and the 'CSV import' text, is dropped.
ALTER TABLE accounts DROP COLUMN institution;
