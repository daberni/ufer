export function environment() {
  const value = process.env.ENABLE_BANKING_ENVIRONMENT || "SANDBOX";

  if (value !== "SANDBOX" && value !== "PRODUCTION") {
    throw new Error("Invalid banking environment.");
  }

  return value;
}
