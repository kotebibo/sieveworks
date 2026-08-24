import type { ServerResponse } from "node:http";

/** Minimal SSE broadcaster. Clients are HTTP responses; events are the live
 * feed the swarm view consumes. Single-machine by design (Fly count=1). */
class Broadcaster {
  private readonly clients = new Set<ServerResponse>();

  add(res: ServerResponse): void {
    this.clients.add(res);
    res.on("close", () => this.clients.delete(res));
  }

  emit(event: string, data: unknown): void {
    const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of this.clients) res.write(frame);
  }

  get size(): number {
    return this.clients.size;
  }
}

export const events = new Broadcaster();
