import * as App from '@zaiusinc/app-sdk';
import {logger} from '@zaiusinc/app-sdk';

import type {ActionName, ActionParams, ActionResults, Envelope} from '../../shared/types';
import {CmsClient} from '../lib/cms';
import {ActionError} from '../lib/errors';
import {ApiError} from '../lib/http';
import {checkLink, Deps, getLinks} from '../lib/links';
import {loadConfig} from '../lib/settings';
import {isAction, PARSERS} from '../lib/validate';

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

type Handlers = {[A in ActionName]: (deps: Deps, params: ActionParams[A]) => Promise<ActionResults[A]>};

const HANDLERS: Handlers = {
  getLinks: (deps, p) => getLinks(deps, p.content),
  checkLink: (deps, p) => checkLink(deps, p.content, p.version),
};

// Actions that hand signed links to the editor. Each success is logged: the extension
// context carries no editor identity, so the log records which versions were shared.
// Never the URL or the signature - whoever holds the link can open the version.
type Audited = {[A in ActionName]?: (result: ActionResults[A]) => Record<string, unknown>};

const AUDITED: Audited = {
  getLinks: ({content, current, latest}) => ({
    content: content.key,
    locale: content.locale,
    version: current?.version ?? null,
    versions: latest.map((l) => l.version),
  }),
};

export class CmsUiExtension extends App.Function {
  public async perform(): Promise<App.Response> {
    const body = (this.request.bodyJSON ?? {}) as RequestBody;
    const action = typeof body.action === 'string' ? body.action : '';
    if (!isAction(action)) return new App.Response(400, fail('unknown_action', action.slice(0, 64)));

    // Everything inside the try: a throw that escapes perform() reaches the editor as an
    // empty "[ExtensionService] Failed to invoke function:".
    try {
      const raw = body.params && typeof body.params === 'object' && !Array.isArray(body.params) ? body.params : {};
      const params = PARSERS[action](raw as Record<string, unknown>);

      const config = await loadConfig();
      if (!config.ok) {
        return new App.Response(412, fail('not_configured', `Missing or not valid in app settings: ${config.missing.join(', ')}.`));
      }
      const deps: Deps = {cms: new CmsClient(config.cms), site: config.site};
      const handler = HANDLERS[action] as (deps: Deps, params: unknown) => Promise<unknown>;
      const result = await handler(deps, params);
      const audit = AUDITED[action] as ((result: unknown) => Record<string, unknown>) | undefined;
      if (audit) logger.info('audit', action, audit(result));
      return new App.Response(200, ok(result));
    } catch (error) {
      if (error instanceof ActionError) {
        return new App.Response(400, fail(error.code, error.message));
      }
      if (error instanceof ApiError) {
        // The detail (status, start of the CMS's answer) stays in the log; the editor gets
        // a plain message for the code.
        logger.warn('Upstream API error', action, error.code, error.message);
        return new App.Response(502, fail(error.code));
      }
      logger.error('CmsUiExtension failure', action, error);
      return new App.Response(500, fail('internal_error'));
    }
  }
}
