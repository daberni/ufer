export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// An expected, user-correctable input failure; its message is safe to show to the user.
export class ValidationError extends Error {}
