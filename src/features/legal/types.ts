export type OperatorDetails = {
  name: string;
  /** Empty when the deployment does not publish a postal address. */
  addressLines: string[];
  email: string;
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
