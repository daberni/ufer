export type OperatorDetails = {
  name: string;
  /** Municipality and country of residence or seat; no street address. */
  residence: string;
  /** Null until the operator publishes a contact address. */
  email: string | null;
};

/** A service provider that processes personal data on the operator's behalf, such as hosting or database infrastructure. */
export type DataProcessor = {
  name: string;
  purpose: string;
  location: string;
};

/** Either complete deployment details for the legal pages or the names of the environment variables that still need a valid value. */
export type LegalConfiguration = {
  configured: true;
  operator: OperatorDetails;
  processors: DataProcessor[];
} | {
  configured: false;
  invalidVariables: string[];
};
