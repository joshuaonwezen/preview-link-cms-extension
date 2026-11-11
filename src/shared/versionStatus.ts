export type StatusIntent = 'success' | 'information' | 'warning' | 'neutral';

export interface StatusBadge {
  label: string;
  intent: StatusIntent;
}

// CMS version statuses, lowercased. Ready and in-review versions aren't live yet, so to
// whoever opens the link they are drafts too.
const KNOWN: Record<string, StatusBadge> = {
  published: {label: 'Published', intent: 'success'},
  draft: {label: 'Draft', intent: 'information'},
  ready: {label: 'Draft', intent: 'information'},
  inreview: {label: 'Draft', intent: 'information'},
  previous: {label: 'Older version', intent: 'warning'},
};

/** The badge for a CMS version status, or null when the CMS gave none. */
export function statusBadge(status: string | null | undefined): StatusBadge | null {
  const raw = status?.trim() ?? '';
  if (!raw) return null;
  const known = KNOWN[raw.toLowerCase()];
  if (known) return known;
  // Anything else in plain words: "awaitingApproval" or "awaiting_approval" -> "Awaiting approval".
  const words = raw
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase();
  return {label: words.charAt(0).toUpperCase() + words.slice(1), intent: 'neutral'};
}
