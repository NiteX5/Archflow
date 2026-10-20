import type { Server } from 'node:http';

/** Loopback only: the service is never exposed to the network by default. */
export const HOST = '127.0.0.1';
export const DEFAULT_PORT = 4870;
/** Ports tried after the requested one before asking the OS for any free port. */
export const FALLBACK_RANGE = 10;

export interface ListenResult {
  port: number;
  /** Ports that were busy, in the order tried. */
  busy: number[];
}

export class PortInUseError extends Error {
  constructor(readonly port: number) {
    super(`Port ${port} is already in use`);
    this.name = 'PortInUseError';
  }
}

function tryListen(server: Server, port: number): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException) => {
      server.off('listening', onListening);
      if (err.code === 'EADDRINUSE') resolve(false);
      else reject(err);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve(true);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, HOST);
  });
}

/**
 * Listens on `port` on loopback. If it is busy and `strict` is false, tries the
 * next ports and finally an OS-assigned one; the caller reports what happened.
 */
export async function listenWithFallback(server: Server, port: number, strict: boolean): Promise<ListenResult> {
  const busy: number[] = [];
  const candidates = strict ? [port] : [...Array.from({ length: FALLBACK_RANGE + 1 }, (_, i) => port + i).filter((p) => p <= 65535), 0];
  for (const candidate of candidates) {
    if (await tryListen(server, candidate)) {
      const address = server.address();
      return { port: typeof address === 'object' && address ? address.port : candidate, busy };
    }
    busy.push(candidate);
  }
  throw new PortInUseError(port);
}
