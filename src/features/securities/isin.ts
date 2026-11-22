const pattern = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/;

/** Whether `code` is an ISO 6166 ISIN: country prefix, nine alphanumerics and a matching Luhn check digit over the letters expanded to numbers. */
export function validIsin(code: string) {
  if (!pattern.test(code)) {
    return false;
  }

  const digits = [...code].map(character => /[A-Z]/.test(character) ? String(character.charCodeAt(0) - 55) : character).join("");
  let sum = 0;

  for (let index = 0; index < digits.length; index += 1) {
    let digit = Number(digits[digits.length - 1 - index]);

    if (index % 2 === 1) {
      digit *= 2;

      if (digit > 9) {
        digit -= 9;
      }
    }

    sum += digit;
  }

  return sum % 10 === 0;
}

/** The first valid ISIN in a booking text, such as a broker's "Kauf IE00B4L5Y983 iShares …"; null without one. */
export function findIsin(text: string) {
  for (const candidate of text.toUpperCase().match(/[A-Z]{2}[A-Z0-9]{9}[0-9]/g) ?? []) {
    if (validIsin(candidate)) {
      return candidate;
    }
  }

  return null;
}
