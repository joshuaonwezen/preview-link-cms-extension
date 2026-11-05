import * as App from '@zaiusinc/app-sdk';
import {logger} from '@zaiusinc/app-sdk';

import type {ActionName, ActionParams, Envelope} from '../../shared/types';
import {CmsClient} from '../lib/cms';
import {ApiError} from '../lib/http';
import {ActionError, checkLink, Deps, getLinks} from '../lib/links';
import {loadConfig} from '../lib/settings';

interface RequestBody {
  action?: unknown;
  params?: unknown;
}

function ok<T>(result: T): Envelope<T> {
  return {ok: true, result};
}

function fail(error: string, message?: string): Envelope<never> {
  return message ? {ok: false, error, message} : {ok: false, error};
}

type Handler = (deps: Deps, params: never) => Promise<unknown>;

const HANDLERS: Record<ActionName, Handler> = {
  getLinks: (deps, p: ActionParams['getLinks']) => getLinks(deps, p.content),
  checkLink: (deps, p: ActionParams['checkLink']) => checkLink(deps, p.content, p.version),
};

export class CmsUiExtension extends App.Function {
  public async perform(): Promise<App.Response> {
    const body = (this.request.bodyJSON ?? {}) as RequestBody;
    const action = typeof body.action === 'string' ? body.action : '';
    const params = (body.params ?? {}) as never;

    const handler = Object.prototype.hasOwnProperty.call(HANDLERS, action) ? HANDLERS[action as ActionName] : null;
    if (!handler) return new App.Response(400, fail('unknown_action', action));

    // Everything inside the try: a throw that escapes perform() reaches the editor as an
    // empty "[ExtensionService] Failed to invoke function:".
    try {
      const config = await loadConfig();
      if (!config.ok) {
        return new App.Response(412, fail('not_configured', `Missing in app settings: ${config.missing.join(', ')}.`));
      }
      const deps: Deps = {cms: new CmsClient(config.cms), site: config.site};
      return new App.Response(200, ok(await handler(deps, params)));
    } catch (error) {
      if (error instanceof ActionError) {
        return new App.Response(400, fail(error.code, error.message));
      }
      if (error instanceof ApiError) {
        logger.warn('Upstream API error', action, error.code, error.message);
        return new App.Response(502, fail(error.code, error.message));
      }
      logger.error('CmsUiExtension failure', action, error);
      return new App.Response(500, fail('internal_error'));
    }
  }
}
