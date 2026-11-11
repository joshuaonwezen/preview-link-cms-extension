import {normalizeKey} from '../../shared/constants';
import type {ActionName, ActionParams, ContentRef} from '../../shared/types';
import {ActionError} from './errors';

// Every value below ends up in a CMS URL path or in a signed link, so each is checked
// against an allow-list here, before any handler runs.

const CONTENT_KEY = /^[0-9a-f]{32}$/;
const LOCALE = /^[A-Za-z]{2,3}([-_][A-Za-z0-9]{2,8})*$/;
const VERSION = /^\d{1,12}$/;

function invalid(field: string, why: string): never {
  throw new ActionError('invalid_input', `${field}: ${why}`);
}

function record(raw: unknown, field: string): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) invalid(field, 'expected an object.');
  return raw as Record<string, unknown>;
}

function str(raw: unknown, field: string, {optional = false, max = 200} = {}): string {
  if (raw === undefined || raw === null || raw === '') {
    if (optional) return '';
    invalid(field, 'required.');
  }
  if (typeof raw !== 'string') invalid(field, 'expected text.');
  if (raw.length > max) invalid(field, `at most ${max} characters.`);
  return raw;
}

export function versionNumber(raw: unknown, field: string, {optional = false} = {}): string {
  const version = str(raw, field, {optional, max: 12});
  if (version && !VERSION.test(version)) invalid(field, 'not a version number.');
  return version;
}

export function contentRef(raw: unknown): ContentRef {
  const ref = record(raw, 'content');
  const key = normalizeKey(str(ref.key, 'content.key', {max: 64}));
  if (!CONTENT_KEY.test(key)) invalid('content.key', 'not a CMS content key.');
  const locale = str(ref.locale, 'content.locale', {optional: true, max: 35});
  if (locale && !LOCALE.test(locale)) invalid('content.locale', 'not a locale code.');
  const version = versionNumber(ref.version, 'content.version', {optional: true});
  return {key, locale, ...(version ? {version} : {})};
}

type Parsers = {[A in ActionName]: (raw: Record<string, unknown>) => ActionParams[A]};

/** One parser per action: unknown fields are dropped, every kept field is checked. */
export const PARSERS: Parsers = {
  getLinks: (p) => ({content: contentRef(p.content)}),
  checkLink: (p) => ({content: contentRef(p.content), version: versionNumber(p.version, 'version')}),
};

export function isAction(action: string): action is ActionName {
  return Object.prototype.hasOwnProperty.call(PARSERS, action);
}
