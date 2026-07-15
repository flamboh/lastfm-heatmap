export interface Env {
  ACTIVITY_CACHE: KVNamespace;
  LASTFM_API_KEY: string;
}

export interface ActivitySnapshot {
  username: string;
  counts: Record<string, number>;
  fetchedThrough: number;
  updatedAt: number;
}

export interface ActivityStore {
  get(key: string): Promise<ActivitySnapshot | null>;
  put(key: string, value: ActivitySnapshot): Promise<void>;
}

export interface ExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void;
}
