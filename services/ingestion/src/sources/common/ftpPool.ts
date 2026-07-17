import { Client } from "basic-ftp";

export type FtpConnectFn = (client: Client) => Promise<void>;

/**
 * Pool of basic-ftp clients. One download at a time per connection
 * (FTP data channels are not safely multiplexed on a single login).
 */
export class FtpPool {
  private idle: Client[] = [];
  private live = 0;
  private closed = false;
  private waiters: Array<(client: Client) => void> = [];

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

    return new Promise<Client>((resolve) => {
      this.waiters.push(resolve);
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
      waiter(client);
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
    void this.acquire().then(waiter, (err) => {
      console.warn(
        JSON.stringify({
          event: "ftp_pool_acquire_failed",
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    });
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
    this.waiters = [];
  }
}
