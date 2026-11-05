import {logger, storage, ValueHash} from '@zaiusinc/app-sdk';

import type {CmsConfig} from './cms';

// Section keys match forms/settings.yml.
// Type aliases, not interfaces: the settings store requires an index-signature-compatible shape.
export type SiteSettings = {
  siteUrl?: string;
  previewSecret?: string;
};

export type CmsSettings = {
  clientId?: string;
  clientSecret?: string;
};

export interface SiteConfig {
  /** Origin (plus optional path) without a trailing slash. */
  url: string;
  previewSecret: string;
}

export type LoadedConfig = {ok: true; site: SiteConfig; cms: CmsConfig} | {ok: false; missing: string[]};

/** https://host[/path] without a trailing slash, or null. */
export function normalizeSiteUrl(raw: string | undefined): string | null {
  const value = raw?.trim() ?? '';
  if (!/^https?:\/\/[^\s/]+/i.test(value)) return null;
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
  } catch {
    return null;
  }
}

/**
 * One settings section, or {} when the store can't be read. On a CMS-scoped install that has
 * never saved its settings, the production store throws "Failed to get value at
 * app-data/<install>/settings" instead of returning {}.
 */
export async function readSection<T extends ValueHash>(section: string): Promise<T> {
  try {
    return await storage.settings.get<T>(section);
  } catch (error) {
    logger.warn('Could not read settings section', section, error);
    return {} as T;
  }
}

export async function loadConfig(): Promise<LoadedConfig> {
  const [siteSettings, cmsSettings] = await Promise.all([
    readSection<SiteSettings>('site'),
    readSection<CmsSettings>('cms'),
  ]);
  const url = normalizeSiteUrl(siteSettings.siteUrl);
  const previewSecret = siteSettings.previewSecret?.trim() ?? '';
  const cms = {clientId: cmsSettings.clientId?.trim() ?? '', clientSecret: cmsSettings.clientSecret?.trim() ?? ''};

  const missing = [
    !url && 'Site URL',
    !previewSecret && 'Preview secret',
    !cms.clientId && 'CMS client ID',
    !cms.clientSecret && 'CMS client secret',
  ].filter((m): m is string => Boolean(m));

  return missing.length > 0 ? {ok: false, missing} : {ok: true, site: {url: url!, previewSecret}, cms};
}
