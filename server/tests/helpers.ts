/**
 * Marks an intentionally partial runtime double as the interface under test.
 * Keep the unsafe assertion centralized so individual tests remain readable.
 */
export function partialMock<T>(value: unknown): T {
  return value as T;
}
