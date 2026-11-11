import {describe, expect, it} from 'vitest';

import {statusBadge} from './versionStatus';

describe('statusBadge', () => {
  it('maps the CMS statuses editors see', () => {
    expect(statusBadge('published')).toEqual({label: 'Published', intent: 'success'});
    expect(statusBadge('draft')).toEqual({label: 'Draft', intent: 'information'});
    expect(statusBadge('previous')).toEqual({label: 'Older version', intent: 'warning'});
  });

  it('treats ready and in-review versions as drafts', () => {
    expect(statusBadge('ready')?.label).toBe('Draft');
    expect(statusBadge('inReview')?.label).toBe('Draft');
    expect(statusBadge('InReview')?.label).toBe('Draft');
  });

  it('says any other status in plain words', () => {
    expect(statusBadge('scheduled')).toEqual({label: 'Scheduled', intent: 'neutral'});
    expect(statusBadge('awaitingApproval')).toEqual({label: 'Awaiting approval', intent: 'neutral'});
    expect(statusBadge('awaiting_approval')?.label).toBe('Awaiting approval');
  });

  it('shows no badge without a status', () => {
    expect(statusBadge('')).toBeNull();
    expect(statusBadge(undefined)).toBeNull();
  });
});
