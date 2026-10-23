import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";
vi.mock("../src/hooks/operation-session", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../src/hooks/operation-session")>();
  const { ClientWriteSession } =
    await import("@marker/shared/clientOperations");
  const session = new ClientWriteSession("test-session", () => "test-session");
  return { ...original, useWriteSession: () => session };
});
