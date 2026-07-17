/** Snapshot and restore process.env keys for feature-flag tests. */
export function snapshotEnv(keys: string[]): () => void {
  const prev = new Map<string, string | undefined>();
  for (const key of keys) prev.set(key, process.env[key]);
  return () => {
    for (const key of keys) {
      const value = prev.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}
