/**
 * Process-local keyed serialization for provider and response side effects.
 * PostgreSQL row locks and conditional writes remain the cross-process source
 * of truth; this avoids duplicate work inside one application process.
 */
const globalState = globalThis as unknown as {
  __btwKeyedMutexes?: Map<string, Promise<void>>;
};

const tails = (globalState.__btwKeyedMutexes ??= new Map());

export async function withKeyedMutex<T>(
  scope: string,
  key: string,
  work: () => Promise<T>,
): Promise<T> {
  const mutexKey = `${scope}:${key}`;
  const previous = tails.get(mutexKey) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => gate);
  tails.set(mutexKey, tail);
  await previous;
  try {
    return await work();
  } finally {
    release();
    if (tails.get(mutexKey) === tail) tails.delete(mutexKey);
  }
}

export const withBookingMutex = <T>(
  bookingId: string,
  work: () => Promise<T>,
) => withKeyedMutex("booking", bookingId, work);

export const withOwnerMutex = <T>(
  ownerId: string,
  work: () => Promise<T>,
) => withKeyedMutex("owner", ownerId, work);
