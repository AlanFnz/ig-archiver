/**
 * Process an array with a bounded number of async workers.
 * Each item is claimed synchronously, so it is processed exactly once.
 */
export async function runConcurrent<T>(items: T[], limit: number, task: (item: T, index: number) => Promise<void>) {
  if (!Array.isArray(items)) throw new TypeError('items must be an array.');
  if (!Number.isInteger(limit) || limit < 1) throw new TypeError('limit must be a positive integer.');
  if (typeof task !== 'function') throw new TypeError('task must be a function.');

  let nextIndex = 0;
  const runWorker = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      await task(items[index], index);
    }
  };

  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    () => runWorker(),
  );
  await Promise.all(workers);
}
