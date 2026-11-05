export const CMS_EXTENSION_FUNCTION_ID = 'cms_extension';

/** Content keys arrive with or without dashes; the CMS API and Graph want 32 hex characters. */
export function normalizeKey(key: string): string {
  return key.replace(/-/g, '').toLowerCase();
}
