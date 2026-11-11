import {afterEach, describe, expect, it, vi} from 'vitest';

import {CmsClient} from './cms';

const APP = {key: 'site_a', hosts: [{authority: 'www.example.com', type: 'primary', preferredUrlScheme: 'https'}]};

// Answers the token request, then each GET /v1/applications from `pages` in order.
function stubCms(pages: unknown[]) {
  const urls: string[] = [];
  const fetchMock = vi.fn((url: string) => {
    if (url.endsWith('/oauth/token')) {
      return Promise.resolve(Response.json({access_token: 'token', expires_in: 3600}));
    }
    urls.push(url);
    return Promise.resolve(Response.json(pages[urls.length - 1] ?? {items: []}));
  });
  vi.stubGlobal('fetch', fetchMock);
  return urls;
}

describe('listApplications', () => {
  afterEach(() => vi.unstubAllGlobals());
  // The token is cached per client ID, so each test uses its own.
  let client = 0;
  const cms = () => new CmsClient({clientId: `apps-${++client}`, clientSecret: 'secret'});

  it('reads the items of a single answer', async () => {
    const urls = stubCms([{items: [APP], pageIndex: 0, pageSize: 10, totalItemCount: 1}]);
    expect(await cms().listApplications()).toEqual([APP]);
    expect(urls).toEqual(['https://api.cms.optimizely.com/v1/applications']);
  });

  it('accepts a bare array', async () => {
    stubCms([[APP]]);
    expect(await cms().listApplications()).toEqual([APP]);
  });

  it('reads further pages only when the answer reports more items', async () => {
    const second = {...APP, key: 'site_b'};
    const urls = stubCms([
      {items: [APP], pageSize: 1, totalItemCount: 2},
      {items: [second], pageSize: 1, totalItemCount: 2},
    ]);
    expect(await cms().listApplications()).toEqual([APP, second]);
    expect(urls[1]).toBe('https://api.cms.optimizely.com/v1/applications?pageIndex=1&pageSize=1');

    const once = stubCms([{items: [APP]}]);
    expect(await cms().listApplications()).toEqual([APP]);
    expect(once).toHaveLength(1);
  });
});
