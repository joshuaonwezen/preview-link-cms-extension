import {describe, expect, it} from 'vitest';

import {contentRef, isAction, PARSERS} from './validate';

const KEY = 'dcf0e497951c4517ac1a7d7ecff0b853';

describe('contentRef', () => {
  it('normalizes the key and keeps known fields only', () => {
    expect(
      contentRef({key: 'DCF0E497-951c-4517-ac1a-7d7ecff0b853', locale: 'en', version: '3198', publicUrl: 'https://x.example/', extra: 1}),
    ).toEqual({key: KEY, locale: 'en', version: '3198', publicUrl: 'https://x.example/'});
  });

  it("accepts only an https page address, and doesn't need one", () => {
    expect(contentRef({key: KEY, publicUrl: ''})).toEqual({key: KEY, locale: ''});
    expect(contentRef({key: KEY, publicUrl: null})).toEqual({key: KEY, locale: ''});
    expect(() => contentRef({key: KEY, publicUrl: 'http://www.example.com/'})).toThrow(/publicUrl: not an https/);
    expect(() => contentRef({key: KEY, publicUrl: 'javascript:alert(1)'})).toThrow(/publicUrl: not an https/);
    expect(() => contentRef({key: KEY, publicUrl: 'https://'})).toThrow(/publicUrl: not a URL/);
    expect(() => contentRef({key: KEY, publicUrl: ['https://www.example.com']})).toThrow(/publicUrl: expected text/);
    const long = `https://www.example.com/${'a'.repeat(2048)}`;
    expect(() => contentRef({key: KEY, publicUrl: long})).toThrow(/publicUrl: at most 2048/);
  });

  it('allows a missing locale and version', () => {
    expect(contentRef({key: KEY})).toEqual({key: KEY, locale: ''});
    expect(contentRef({key: KEY, locale: 'nl-BE', version: ''})).toEqual({key: KEY, locale: 'nl-BE'});
  });

  it('rejects values that would reach an API path or a signed link', () => {
    expect(() => contentRef(undefined)).toThrow(/content/);
    expect(() => contentRef({})).toThrow(/content\.key/);
    expect(() => contentRef({key: '../../v1/contenttypes'})).toThrow(/content key/);
    expect(() => contentRef({key: `${KEY}0`})).toThrow(/content key/);
    expect(() => contentRef({key: KEY, version: '1/../2'})).toThrow(/version/);
    expect(() => contentRef({key: KEY, version: 3198})).toThrow(/version/);
    expect(() => contentRef({key: KEY, locale: 'en/../x'})).toThrow(/locale/);
    expect(() => contentRef({key: KEY, locale: 'en&ver=1'})).toThrow(/locale/);
  });
});

describe('PARSERS', () => {
  it('requires a version number to check a link', () => {
    const content = {key: KEY, locale: 'en'};
    expect(PARSERS.checkLink({content, version: '3198', url: 'https://evil.example'})).toEqual({content, version: '3198'});
    expect(() => PARSERS.checkLink({content})).toThrow(/version: required/);
    expect(() => PARSERS.checkLink({content, version: '3198&sig=x'})).toThrow(/version/);
    expect(() => PARSERS.checkLink({content, version: '1234567890123'})).toThrow(/version/);
  });

  it('drops unknown fields from getLinks', () => {
    expect(PARSERS.getLinks({content: {key: KEY, locale: 'en'}, siteUrl: 'https://evil.example'})).toEqual({
      content: {key: KEY, locale: 'en'},
    });
  });
});

describe('isAction', () => {
  it('knows only the actions that have a parser', () => {
    expect(isAction('getLinks')).toBe(true);
    expect(isAction('checkLink')).toBe(true);
    expect(isAction('toString')).toBe(false);
    expect(isAction('__proto__')).toBe(false);
  });
});
