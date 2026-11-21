-- CSV imports stored the fixed text 'CSV import' as the institution of the accounts they created; the import origin is not an institution.
-- Clears exactly that value to the empty institution new CSV-created accounts get; institutions users entered themselves stay unchanged. The column is NOT NULL, so the empty string stands for "no institution".
UPDATE accounts SET institution='' WHERE institution='CSV import';
