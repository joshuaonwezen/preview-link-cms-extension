import {
  AuthorizationGrantResult,
  CanUninstallResult,
  Lifecycle as AppLifecycle,
  LifecycleResult,
  LifecycleSettingsResult,
  logger,
  storage,
  SubmittedFormData,
  Request as AppRequest,
} from '@zaiusinc/app-sdk';

import {CmsClient} from '../lib/cms';
import {ApiError} from '../lib/http';
import {checkSiteUrl, CmsSettings, readSection, SiteSettings} from '../lib/settings';

const SITE_CHECK_TIMEOUT_MS = 15_000;

function text(formData: SubmittedFormData, key: string): string {
  const value = formData[key];
  return typeof value === 'string' ? value.trim() : '';
}

export class Lifecycle extends AppLifecycle {
  public async onInstall(): Promise<LifecycleResult> {
    return {success: true};
  }

  public async onUpgrade(_fromVersion: string): Promise<LifecycleResult> {
    return {success: true};
  }

  public async onFinalizeUpgrade(_fromVersion: string): Promise<LifecycleResult> {
    return {success: true};
  }

  public async onAfterUpgrade(): Promise<LifecycleResult> {
    return {success: true};
  }

  public async canUninstall(): Promise<CanUninstallResult> {
    return {uninstallable: true};
  }

  public async onUninstall(): Promise<LifecycleResult> {
    return {success: true};
  }

  public async onSettingsForm(
    section: string,
    action: string,
    formData: SubmittedFormData,
  ): Promise<LifecycleSettingsResult> {
    const result = new LifecycleSettingsResult();
    try {
      if (section === 'site' && action === 'saveSite') return await this.saveSite(formData, result);
      if (section === 'cms' && action === 'saveCms') return await this.saveCms(formData, result);
    } catch (error) {
      logger.error('Settings save failed', error);
      return result.addToast('danger', 'Could not save settings. Try again.');
    }
    logger.warn('Unsupported section-action combination:', section, action);
    return result;
  }

  // The secret can't be proven here without a page to sign a link for; the sidebar opens
  // its first link on the site and says so when the site rejects it.
  private async saveSite(formData: SubmittedFormData, result: LifecycleSettingsResult) {
    const previous = await readSection<SiteSettings>('site');
    const site = checkSiteUrl(text(formData, 'siteUrl'));
    // A secret field comes back blank when the editor didn't retype it - keep the stored one.
    const newSecret = text(formData, 'previewSecret');
    const previewSecret = newSecret || previous.previewSecret || '';
    if (!site.ok) return result.addError('siteUrl', site.reason);
    if (!previewSecret) return result.addError('previewSecret', 'Required.');

    // Only whether the address answers. A redirect isn't followed, so the check never
    // reaches a host other than the one saved.
    try {
      const res = await fetch(site.url, {redirect: 'manual', signal: AbortSignal.timeout(SITE_CHECK_TIMEOUT_MS)});
      if (res.status >= 500) {
        return result
          .addError('siteUrl', `The site answered with a server error (HTTP ${res.status}).`)
          .addToast('danger', 'Could not reach the site.');
      }
    } catch {
      return result.addError('siteUrl', 'No answer from this URL.').addToast('danger', 'Could not reach the site.');
    }

    await storage.settings.put('site', {siteUrl: site.url, previewSecret});
    logger.info('audit', 'saveSite', {siteUrl: site.url, newPreviewSecret: Boolean(newSecret)});
    return result.addToast('success', 'Site settings saved.');
  }

  private async saveCms(formData: SubmittedFormData, result: LifecycleSettingsResult) {
    const previous = await readSection<CmsSettings>('cms');
    const newSecret = text(formData, 'clientSecret');
    const next: CmsSettings = {
      clientId: text(formData, 'clientId'),
      clientSecret: newSecret || previous.clientSecret || '',
    };
    if (!next.clientId) return result.addError('clientId', 'Required.');
    if (!next.clientSecret) return result.addError('clientSecret', 'Required.');

    try {
      await new CmsClient({clientId: next.clientId, clientSecret: next.clientSecret}).token();
    } catch (error) {
      if (error instanceof ApiError && error.status < 500) {
        return result
          .addError('clientSecret', 'The CMS rejected this client ID / secret.')
          .addToast('danger', 'The CMS rejected the API client credentials.');
      }
      throw error;
    }

    await storage.settings.put('cms', {...next});
    logger.info('audit', 'saveCms', {clientId: next.clientId, newClientSecret: Boolean(newSecret)});
    return result.addToast('success', 'CMS API client saved.');
  }

  public async onAuthorizationRequest(
    _section: string,
    _formData: SubmittedFormData,
  ): Promise<LifecycleSettingsResult> {
    return new LifecycleSettingsResult().addToast('danger', 'OAuth is not supported.');
  }

  public async onAuthorizationGrant(_request: AppRequest): Promise<AuthorizationGrantResult> {
    return new AuthorizationGrantResult('').addToast('danger', 'OAuth is not supported.');
  }
}
