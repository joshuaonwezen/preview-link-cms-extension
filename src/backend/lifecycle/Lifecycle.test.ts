import {logger, resetLocalSettingsStore, storage} from '@zaiusinc/app-sdk';
import {afterEach, describe, expect, it, vi} from 'vitest';

import {Lifecycle} from './Lifecycle';

async function saveSite(formData: Record<string, string>) {
  const result = await new Lifecycle().onSettingsForm('site', 'saveSite', formData);
  return result.getResponse('site');
}

describe('saving the site settings', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    resetLocalSettingsStore();
  });

  it('refuses an internal address without contacting it', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const response = await saveSite({siteUrl: 'https://localhost:3000', previewSecret: 'secret'});
    expect(response.errors?.['site.siteUrl']?.[0]).toMatch(/public address/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await storage.settings.get('site')).toEqual({});
  });

  it('checks the address answers without following redirects, then saves and logs it', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, {status: 308, headers: {location: 'https://10.0.0.1/'}}));
    vi.stubGlobal('fetch', fetchMock);
    const info = vi.spyOn(logger, 'info').mockImplementation(() => undefined);

    const response = await saveSite({siteUrl: 'https://www.example.com/', previewSecret: 'top-secret'});

    expect(response.errors).toEqual({});
    expect(fetchMock).toHaveBeenCalledWith('https://www.example.com', expect.objectContaining({redirect: 'manual'}));
    expect(await storage.settings.get('site')).toEqual({siteUrl: 'https://www.example.com', previewSecret: 'top-secret'});
    expect(info).toHaveBeenCalledWith('audit', 'saveSite', {siteUrl: 'https://www.example.com', newPreviewSecret: true});
    expect(JSON.stringify(info.mock.calls)).not.toContain('top-secret');
  });

  it('keeps the saved secret when the field comes back blank', async () => {
    await storage.settings.put('site', {siteUrl: 'https://www.example.com', previewSecret: 'kept'});
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', {status: 200})));
    const info = vi.spyOn(logger, 'info').mockImplementation(() => undefined);

    await saveSite({siteUrl: 'https://preview.example.com', previewSecret: ''});

    expect(await storage.settings.get('site')).toEqual({siteUrl: 'https://preview.example.com', previewSecret: 'kept'});
    expect(info).toHaveBeenCalledWith('audit', 'saveSite', {siteUrl: 'https://preview.example.com', newPreviewSecret: false});
  });

  it('does not save a site that answers with a server error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', {status: 503})));
    const response = await saveSite({siteUrl: 'https://www.example.com', previewSecret: 'secret'});
    expect(response.errors?.['site.siteUrl']?.[0]).toMatch(/server error/);
    expect(await storage.settings.get('site')).toEqual({});
  });
});
