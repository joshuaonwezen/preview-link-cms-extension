import {logger, resetLocalSettingsStore, storage} from '@zaiusinc/app-sdk';
import {afterEach, describe, expect, it, vi} from 'vitest';

import {checkSiteUrl, loadConfig, normalizeSiteUrl} from './settings';

function reason(raw: string): string | null {
  const checked = checkSiteUrl(raw);
  return checked.ok ? null : checked.reason;
}

describe('checkSiteUrl', () => {
  it('normalizes a public https address', () => {
    expect(normalizeSiteUrl(' https://optimizely-onboarding.vercel.app/ ')).toBe('https://optimizely-onboarding.vercel.app');
    expect(normalizeSiteUrl('https://www.example.com:8443/en/?x=1#top')).toBe('https://www.example.com:8443/en');
  });

  it('wants a full URL', () => {
    expect(normalizeSiteUrl('optimizely-onboarding.vercel.app')).toBeNull();
    expect(normalizeSiteUrl('')).toBeNull();
    expect(normalizeSiteUrl(undefined)).toBeNull();
    expect(reason('ftp://files.example.com')).toMatch(/full URL/);
  });

  it('wants https', () => {
    expect(reason('http://www.example.com')).toMatch(/https/);
  });

  it('refuses IP addresses, however they are written', () => {
    for (const url of [
      'https://127.0.0.1',
      'https://10.0.0.5:8443/site',
      'https://169.254.169.254/latest/meta-data',
      'https://2130706433/',
      'https://0x7f.1/',
      'https://[::1]/',
      'https://[fd00::1]:443/',
    ]) {
      expect(reason(url), url).toMatch(/IP address/);
    }
  });

  it('refuses local and internal host names', () => {
    for (const url of [
      'https://localhost:3000',
      'https://LOCALHOST./',
      'https://app.localhost',
      'https://printer.local',
      'https://api.corp.internal/preview',
      'https://intranet/',
    ]) {
      expect(reason(url), url).toMatch(/public address/);
    }
  });

  it('refuses credentials in the URL', () => {
    expect(reason('https://user:pass@www.example.com')).toMatch(/user name and password/);
  });
});

describe('loadConfig', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetLocalSettingsStore();
  });

  it('treats an unreadable store as empty, so loadConfig reports missing settings', async () => {
    // What the production store throws on an install that has never saved its settings.
    vi.spyOn(storage.settings, 'get').mockRejectedValue(new Error('Failed to get value at app-data/1/settings'));
    vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    expect(await loadConfig()).toEqual({
      ok: false,
      missing: ['Preview secret', 'CMS client ID', 'CMS client secret'],
    });
  });

  it('does not need a site URL: links then go to the CMS application hosts', async () => {
    await storage.settings.put('site', {siteUrl: '', previewSecret: 'secret'});
    await storage.settings.put('cms', {clientId: 'id', clientSecret: 'secret'});
    expect(await loadConfig()).toEqual({
      ok: true,
      site: {url: '', previewSecret: 'secret'},
      cms: {clientId: 'id', clientSecret: 'secret'},
    });
  });

  it('does not sign links for a site address saved before https was required', async () => {
    await storage.settings.put('site', {siteUrl: 'http://www.example.com', previewSecret: 'secret'});
    await storage.settings.put('cms', {clientId: 'id', clientSecret: 'secret'});
    expect(await loadConfig()).toEqual({ok: false, missing: ['Site URL']});
  });
});
