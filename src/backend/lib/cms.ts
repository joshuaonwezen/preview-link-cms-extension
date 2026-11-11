import {ApiError, requestJson} from './http';
import type {CmsApplication} from './siteUrl';

const CMS_API = 'https://api.cms.optimizely.com';
const PAGE_SIZE = 100;
// A page re-seeded for months can have hundreds of versions; variations are found by
// scanning them, so cap the scan rather than let one call eat the function's budget.
const MAX_PAGES = 10;
const EXPIRY_BUFFER_MS = 30_000;

export interface CmsConfig {
  clientId: string;
  clientSecret: string;
}

export interface CmsVersion {
  key: string;
  version: string;
  locale: string;
  status: string;
  displayName?: string;
  /** Absent on base versions. */
  variation?: string | null;
}

export interface CmsItem {
  key: string;
  contentType?: string;
  primaryLocale?: string | null;
  /** [''] for items without language versions (media, folders). */
  locales?: string[];
}

/** One page of a CMS list endpoint. */
interface ListPage<T> {
  items?: T[];
  pageSize?: number;
  totalItemCount?: number;
}

// Module scope survives warm invocations of the function.
let tokenCache: {clientId: string; token: string; expiresAt: number} | null = null;

export class CmsClient {
  private readonly cfg: CmsConfig;

  public constructor(cfg: CmsConfig) {
    this.cfg = cfg;
  }

  /** Not a secret: scopes caches to this install's API client. */
  public get clientId(): string {
    return this.cfg.clientId;
  }

  public async token(): Promise<string> {
    if (tokenCache && tokenCache.clientId === this.cfg.clientId && tokenCache.expiresAt > Date.now() + EXPIRY_BUFFER_MS) {
      return tokenCache.token;
    }
    const body = await requestJson<{access_token: string; expires_in: number}>('cms', 'CMS token', `${CMS_API}/oauth/token`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        grant_type: 'client_credentials',
        client_id: this.cfg.clientId,
        client_secret: this.cfg.clientSecret,
      }),
    });
    if (!body?.access_token) throw new ApiError(502, 'cms_unavailable', 'CMS token: no access_token in response');
    tokenCache = {clientId: this.cfg.clientId, token: body.access_token, expiresAt: Date.now() + body.expires_in * 1000};
    return body.access_token;
  }

  private async get<T>(label: string, path: string): Promise<T | null> {
    return requestJson<T>('cms', label, `${CMS_API}${path}`, {
      headers: {Authorization: `Bearer ${await this.token()}`},
    });
  }

  public async getItem(key: string): Promise<CmsItem | null> {
    try {
      return await this.get<CmsItem>('Get content', `/v1/content/${key}`);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    }
  }

  public async primaryLocale(key: string): Promise<string> {
    return (await this.getItem(key))?.primaryLocale || 'en';
  }

  /** Every version of the item in `locale`, newest first (capped at MAX_PAGES pages). */
  public async listVersions(key: string, locale: string): Promise<CmsVersion[]> {
    const versions: CmsVersion[] = [];
    for (let pageIndex = 0; pageIndex < MAX_PAGES; pageIndex++) {
      const page = await this.get<{items?: CmsVersion[]}>(
        'List versions',
        `/v1/content/${key}/locales/${encodeURIComponent(locale)}?pageSize=${PAGE_SIZE}&pageIndex=${pageIndex}`,
      );
      const items = page?.items ?? [];
      versions.push(...items);
      if (items.length < PAGE_SIZE) break;
    }
    return versions;
  }

  public async getVersion(key: string, version: string): Promise<CmsVersion | null> {
    try {
      return await this.get<CmsVersion>('Get version', `/v1/content/${key}/versions/${encodeURIComponent(version)}`);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    }
  }

  /**
   * The CMS's applications (Settings > Applications), each with its hosts. Answers have
   * been `{items: [...]}`; a bare array is accepted too. Further pages are read only when
   * the answer reports more items than it holds.
   */
  public async listApplications(): Promise<CmsApplication[]> {
    const apps: CmsApplication[] = [];
    let path = '/v1/applications';
    for (let pageIndex = 0; pageIndex < MAX_PAGES; pageIndex++) {
      const page = await this.get<ListPage<CmsApplication> | CmsApplication[]>('List applications', path);
      if (Array.isArray(page)) return page;
      const items = Array.isArray(page?.items) ? page.items : [];
      apps.push(...items);
      const total = page?.totalItemCount;
      if (items.length === 0 || typeof total !== 'number' || apps.length >= total) break;
      const size = typeof page?.pageSize === 'number' && page.pageSize > 0 ? Math.floor(page.pageSize) : items.length;
      path = `/v1/applications?pageIndex=${pageIndex + 1}&pageSize=${size}`;
    }
    return apps;
  }
}
