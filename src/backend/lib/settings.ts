import {isIP} from 'node:net';

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
  /**
   * The admin's override: origin (plus optional path) without a trailing slash. '' when
   * left blank, and each page's site then comes from CMS Settings > Applications.
   */
  url: string;
  previewSecret: string;
}

export type LoadedConfig = {ok: true; site: SiteConfig; cms: CmsConfig} | {ok: false; missing: string[]};

export type SiteUrlCheck = {ok: true; url: string} | {ok: false; reason: string};

// Names that only resolve inside a network. The function opens links on this site from
// Optimizely's servers, so the address must be a public one.
const PRIVATE_SUFFIXES = ['.localhost', '.local', '.internal'];

/** https://host[/path] without a trailing slash, or why the value can't be the site's address. */
export function checkSiteUrl(raw: string | undefined): SiteUrlCheck {
  const value = raw?.trim() ?? '';
  let url: URL | null = null;
  try {
    url = /^https?:\/\/[^\s/]+/i.test(value) ? new URL(value) : null;
  } catch {
    url = null;
  }
  if (!url) return {ok: false, reason: 'A full URL, e.g. https://www.example.com.'};
  if (url.protocol !== 'https:') return {ok: false, reason: 'Use an https:// address.'};
  if (url.username || url.password) return {ok: false, reason: 'Leave the user name and password out of the URL.'};

  // The URL parser has already turned 2130706433 or 0x7f.1 into 127.0.0.1.
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (isIP(host.replace(/^\[|\]$/g, ''))) return {ok: false, reason: "Use the site's host name, not an IP address."};
  // Includes localhost and any other name without a dot.
  if (!host.includes('.') || PRIVATE_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    return {ok: false, reason: "Use the site's public address. Local and internal host names can't be reached."};
  }
  return {ok: true, url: `${url.origin}${url.pathname.replace(/\/+$/, '')}`};
}

/** https://host[/path] without a trailing slash, or null. */
export function normalizeSiteUrl(raw: string | undefined): string | null {
  const checked = checkSiteUrl(raw);
  return checked.ok ? checked.url : null;
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
  // The site URL is optional, but one that is saved and can't be used (saved before https
  // was required) is reported rather than quietly replaced by the CMS's own hosts.
  const savedUrl = siteSettings.siteUrl?.trim() ?? '';
  const url = savedUrl ? normalizeSiteUrl(savedUrl) : '';
  const previewSecret = siteSettings.previewSecret?.trim() ?? '';
  const cms = {clientId: cmsSettings.clientId?.trim() ?? '', clientSecret: cmsSettings.clientSecret?.trim() ?? ''};

  const missing = [
    url === null && 'Site URL',
    !previewSecret && 'Preview secret',
    !cms.clientId && 'CMS client ID',
    !cms.clientSecret && 'CMS client secret',
  ].filter((m): m is string => Boolean(m));

  return missing.length > 0 ? {ok: false, missing} : {ok: true, site: {url: url ?? '', previewSecret}, cms};
}
