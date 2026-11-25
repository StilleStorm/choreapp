/**
 * Offline queue for "Zrobiłem". A tap is stored on the phone with its own
 * idempotency key and tap time, and sent when the connection is back. The
 * server deduplicates by key, so retries are always safe.
 */
import { Network } from '@capacitor/network';
import { Preferences } from '@capacitor/preferences';
import { ApiFailure, api } from './api.js';

const KEY = 'offline_reports';

export interface QueuedReport {
  occurrenceId: string;
  clientOpId: string;
  reportedAt: number;
}

class OfflineQueue {
  items = $state<QueuedReport[]>([]);
  online = $state(true);
  private flushing = false;
  private listeners: (() => void)[] = [];

  async init(): Promise<void> {
    const raw = (await Preferences.get({ key: KEY })).value;
    this.items = raw ? (JSON.parse(raw) as QueuedReport[]) : [];
    try {
      this.online = (await Network.getStatus()).connected;
      await Network.addListener('networkStatusChange', (s) => {
        this.online = s.connected;
        if (s.connected) void this.flush();
      });
    } catch {
      this.online = navigator.onLine;
    }
    void this.flush();
  }

  /** Called after a successful flush so screens can reload. */
  onFlushed(fn: () => void): () => void {
    this.listeners.push(fn);
    return () => (this.listeners = this.listeners.filter((l) => l !== fn));
  }

  isQueued(occurrenceId: string): boolean {
    return this.items.some((i) => i.occurrenceId === occurrenceId);
  }

  private async save(): Promise<void> {
    await Preferences.set({ key: KEY, value: JSON.stringify(this.items) });
  }

  /** Reports now, or queues the report when offline. Throws other API errors. */
  async report(occurrenceId: string): Promise<'sent' | 'queued'> {
    const item: QueuedReport = { occurrenceId, clientOpId: crypto.randomUUID(), reportedAt: Date.now() };
    try {
      await api.post(`/v1/occurrences/${occurrenceId}/report`, { clientOpId: item.clientOpId });
      return 'sent';
    } catch (e) {
      if (e instanceof ApiFailure && e.status === 0) {
        this.items = [...this.items, item];
        this.online = false;
        await this.save();
        return 'queued';
      }
      throw e;
    }
  }

  async flush(): Promise<void> {
    if (this.flushing || this.items.length === 0) return;
    this.flushing = true;
    let sentAny = false;
    try {
      for (const item of [...this.items]) {
        try {
          await api.post(`/v1/occurrences/${item.occurrenceId}/report`, { clientOpId: item.clientOpId, reportedAt: item.reportedAt });
          sentAny = true;
        } catch (e) {
          // Still offline: stop and try again later.
          if (e instanceof ApiFailure && e.status === 0) break;
          // Anything else (already done, task deleted): nothing more to send.
        }
        this.items = this.items.filter((i) => i.clientOpId !== item.clientOpId);
        await this.save();
      }
      if (this.items.length === 0) this.online = true;
    } finally {
      this.flushing = false;
    }
    if (sentAny) for (const l of this.listeners) l();
  }
}

export const offline = new OfflineQueue();
