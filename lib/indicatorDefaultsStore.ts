import type { IndicatorSettings } from './indicatorFramework';

const LEGACY_KEY = 'indicator_defaults';
const DATABASE_NAME = 'btc-mood-indicator-defaults';
const STORE_NAME = 'defaults';
export const INDICATOR_DEFAULTS_CHANGED_EVENT = 'btc-mood:indicator-defaults-changed';

type SavedDefault = { id: string; settings: IndicatorSettings };
let databasePromise: Promise<IDBDatabase> | null = null;

/** Read older defaults synchronously so the first chart render keeps its settings. */
export function readLegacyIndicatorDefaults(): Record<string, IndicatorSettings> {
  try {
    if (typeof window === 'undefined') return {};
    const parsed: unknown = JSON.parse(window.localStorage.getItem(LEGACY_KEY) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, IndicatorSettings>
      : {};
  } catch {
    return {};
  }
}

function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;
  const opening = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is unavailable.'));
      return;
    }
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => {
        database.close();
        databasePromise = null;
      };
      resolve(database);
    };
    request.onerror = () => reject(request.error ?? new Error('Could not open indicator defaults.'));
    request.onblocked = () => reject(new Error('Indicator defaults storage is blocked by another tab.'));
  }).catch((error) => {
    databasePromise = null;
    throw error;
  });
  databasePromise = opening;
  return opening;
}

export async function loadIndicatorDefaults(): Promise<Record<string, IndicatorSettings>> {
  const defaults = readLegacyIndicatorDefaults();
  try {
    const database = await openDatabase();
    const saved = await new Promise<SavedDefault[]>((resolve, reject) => {
      const request = database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll();
      request.onsuccess = () => resolve(request.result as SavedDefault[]);
      request.onerror = () => reject(request.error ?? new Error('Could not read indicator defaults.'));
    });
    for (const entry of saved) {
      if (entry?.id && entry.settings) defaults[entry.id] = entry.settings;
    }
  } catch {
    // Existing localStorage defaults still work when IndexedDB is unavailable.
  }
  return defaults;
}

export async function saveIndicatorDefault(id: string, settings: IndicatorSettings): Promise<boolean> {
  try {
    const database = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('Could not save indicator default.'));
      transaction.onabort = () => reject(transaction.error ?? new Error('Could not save indicator default.'));
      transaction.objectStore(STORE_NAME).put({ id, settings } satisfies SavedDefault);
    });
  } catch {
    // Older browsers may lack IndexedDB. Retain the previous storage path,
    // but never allow a quota or security error to escape the settings panel.
    try {
      const defaults = readLegacyIndicatorDefaults();
      defaults[id] = settings;
      localStorage.setItem(LEGACY_KEY, JSON.stringify(defaults));
    } catch {
      return false;
    }
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(INDICATOR_DEFAULTS_CHANGED_EVENT));
  return true;
}
