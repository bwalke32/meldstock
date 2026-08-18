import 'server-only';
import type { AnalyticsService } from './types';
export class NoopAnalyticsService implements AnalyticsService {
  async record(event: { name: string }): Promise<void> {
    void event;
  }
}
export class PolsiaAnalyticsService implements AnalyticsService {
  constructor(
    private readonly baseUrl: string,
    private readonly slug: string,
  ) {}
  async record(event: { name: string; path?: string }) {
    const url = new URL('/api/beacon/event', this.baseUrl);
    await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug: this.slug, ...event }),
    });
  }
}
