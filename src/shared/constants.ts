export const CMS_EXTENSION_FUNCTION_ID = 'cms_extension';

/** Longest page address the sidebar sends and the backend accepts. */
export const PUBLIC_URL_MAX_LENGTH = 2048;

/** Content keys arrive with or without dashes; the CMS API and Graph want 32 hex characters. */
export function normalizeKey(key: string): string {
  return key.replace(/-/g, '').toLowerCase();
}
