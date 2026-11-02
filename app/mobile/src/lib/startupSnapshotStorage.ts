import { File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import { SNAPSHOT_MAX_BYTES, StartupSnapshotStore } from './startupSnapshot';

const filename = 'marker-startup-v1.json';
export const startupSnapshotStore = new StartupSnapshotStore({
  async read() {
    if (Platform.OS === 'web') return null;
    const file = new File(Paths.cache, filename);
    if (!file.exists || file.size > SNAPSHOT_MAX_BYTES) return null;
    return file.text();
  },
  async write(text) {
    if (Platform.OS === 'web') return;
    // Cache directory is app-private and disposable, excluded from device backups.
    const temporary = new File(Paths.cache, `${filename}.tmp`);
    temporary.write(text);
    temporary.move(new File(Paths.cache, filename), { overwrite: true });
  },
  async remove() {
    if (Platform.OS === 'web') return;
    for (const name of [filename, `${filename}.tmp`]) {
      const file = new File(Paths.cache, name);
      if (file.exists) file.delete();
    }
  },
});

// Disk work overlaps Clerk's network request; nothing is exposed until identity matches.
void startupSnapshotStore.read();
