export function isTransientIngestionError(message: string): boolean {
  return /client is closed|connection terminated|server sent fin|econnreset|epipe|etimedout|server closed the connection|fetch failed|operation was aborted|timeouterror|econnrefused|ehostunreach|too many clients|terminating connection|timeout exceeded when trying to connect|ftp pool acquire timeout/i.test(
    message,
  );
}
