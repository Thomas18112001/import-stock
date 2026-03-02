export function toPublicErrorMessage(error: unknown, fallback: string): string {
  if (process.env.NODE_ENV === "production") {
    return fallback;
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return fallback;
}
