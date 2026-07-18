import { Client } from "basic-ftp";

export type FtpConnectFn = (client: Client) => Promise<void>;

interface Waiter {
  resolve: (client: Client) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

/**
 * Pool of basic-ftp clients. One download at a time per connection
 * (FTP data channels are not safely multiplexed on a single login).
 */
export class FtpPool {
  private idle: Client[] = [];
  private live = 0;
  private closed = false;
  private waiters: Waiter[] = [];

  constructor(
    private readonly maxSize: number,
    private readonly connect: FtpConnectFn,
    private readonly timeoutMs = 120_000,
  ) {}

  async withClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
    const client = await this.acquire();
    let reusable = true;
    try {
      return await fn(client);
    } catch (err) {
      reusable = false;
      try {
        client.close();
      } catch {
        /* ignore */
      }
      this.live = Math.max(0, this.live - 1);
      this.pumpWaiters();
      throw err;
    } finally {
      if (reusable) this.release(client);
    }
  }

  private async acquire(): Promise<Client> {
    if (this.closed) throw new Error("FtpPool is closed");
    const idle = this.idle.pop();
    if (idle) return idle;

    if (this.live < this.maxSize) {
      this.live++;
      const client = new Client(this.timeoutMs);
      client.ftp.verbose = false;
      try {
        await this.connect(client);
        return client;
      } catch (err) {
        this.live--;
        try {
          client.close();
        } catch {
          /* ignore */
        }
        throw err;
      }
    }

    return new Promise<Client>((resolve, reject) => {
      const timer = setTimeout(() => {
        const i = this.waiters.findIndex((w) => w.timer === timer);
        if (i >= 0) this.waiters.splice(i, 1);
        reject(new Error("ftp pool acquire timeout"));
      }, this.timeoutMs);
      this.waiters.push({ resolve, reject, timer });
    });
  }

  private release(client: Client): void {
    if (this.closed || client.closed) {
      try {
        client.close();
      } catch {
        /* ignore */
      }
      this.live = Math.max(0, this.live - 1);
      this.pumpWaiters();
      return;
    }
    const waiter = this.waiters.shift();
    if (waiter) {
      clearTimeout(waiter.timer);
      waiter.resolve(client);
      return;
    }
    this.idle.push(client);
  }

  private pumpWaiters(): void {
    // New capacity may be free after a broken connection; wake one waiter by
    // creating a fresh client if under maxSize.
    if (!this.waiters.length || this.live >= this.maxSize) return;
    const waiter = this.waiters.shift();
    if (!waiter) return;
    clearTimeout(waiter.timer);
    void this.acquire().then(
      (client) => waiter.resolve(client),
      (err) => {
        console.warn(
          JSON.stringify({
            event: "ftp_pool_acquire_failed",
            error: err instanceof Error ? err.message : String(err),
          }),
        );
        waiter.reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  }

  close(): void {
    this.closed = true;
    for (const c of this.idle) {
      try {
        c.close();
      } catch {
        /* ignore */
      }
    }
    this.idle = [];
    this.live = 0;
    for (const w of this.waiters.splice(0)) {
      clearTimeout(w.timer);
      w.reject(new Error("FtpPool is closed"));
    }
  }
}
