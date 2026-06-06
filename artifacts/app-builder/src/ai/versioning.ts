/**
 * Versioning — Stores previous versions of generated apps with rollback support.
 */

export interface AppVersion {
  id: string;
  html: string;
  label: string;
  score: number;
  iteration: number;
  timestamp: number;
  userIdea: string;
}

const STORAGE_KEY = "mellow_versions";
const MAX_VERSIONS = 30;

/** Load all versions from storage */
export function loadVersions(): AppVersion[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/** Save a new version */
export function saveVersion(version: Omit<AppVersion, "id" | "timestamp">): AppVersion {
  const versions = loadVersions();
  const newVersion: AppVersion = {
    ...version,
    id: crypto.randomUUID(),
    timestamp: Date.now(),
  };

  versions.unshift(newVersion);
  if (versions.length > MAX_VERSIONS) versions.length = MAX_VERSIONS;

  localStorage.setItem(STORAGE_KEY, JSON.stringify(versions));
  return newVersion;
}

/** Rollback to a specific version by ID */
export function rollbackToVersion(versionId: string): AppVersion | null {
  const versions = loadVersions();
  return versions.find((v) => v.id === versionId) || null;
}

/** Get the latest version */
export function getLatestVersion(): AppVersion | null {
  const versions = loadVersions();
  return versions[0] || null;
}

/** Delete a version */
export function deleteVersion(versionId: string): void {
  const versions = loadVersions().filter((v) => v.id !== versionId);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(versions));
}

/** Clear all versions */
export function clearVersions(): void {
  localStorage.removeItem(STORAGE_KEY);
}
