import type { SyncStorage } from "./sync";

export interface SessionStorage extends SyncStorage {
  remove(key: string): Promise<void>;
}
