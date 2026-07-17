export function isTransientIngestionError(message: string): boolean {
  return /client is closed|connection terminated|server sent fin|econnreset|epipe|etimedout|server closed the connection/i.test(
    message,
  );
}
