import type {ExtensionContext} from '@optimizely/cms-extensibility-sdk';
import {CMS_EXTENSION_FUNCTION_ID} from '@shared/constants';
import type {ActionName, ActionParams, ActionResults, Envelope} from '@shared/types';

export class CallError extends Error {
  public readonly code: string;

  public constructor(code: string, message: string) {
    super(message);
    this.name = 'CallError';
    this.code = code;
  }
}

// The backend sends a message with every error it can explain; these cover the rest,
// including CMS errors, whose detail stays in the app's log.
const FALLBACK_MESSAGES: Record<string, string> = {
  not_configured: 'The app is missing settings.',
  cms_unauthorized: "The CMS turned down the app's API client. Ask a CMS admin to check it in the app settings.",
  cms_not_found: "The CMS couldn't find this item. Reload the page in the editor and try again.",
  cms_rate_limited: 'The CMS is busy. Try again in a moment.',
  cms_rejected: 'The CMS turned down the request. Try again; if it keeps happening, ask a CMS admin.',
  cms_unavailable: "The CMS didn't answer. Try again in a moment.",
  internal_error: 'Something went wrong in the Share preview app. Try again.',
  backend_unreachable:
    "The Share preview app didn't answer. Try again; if it keeps happening, ask a CMS admin to check the app.",
};

const GENERIC_MESSAGE = 'Something went wrong. Try again.';

/** Calls one backend action; resolves with its result or throws CallError. */
export async function call<A extends ActionName>(
  context: ExtensionContext,
  action: A,
  params: ActionParams[A],
): Promise<ActionResults[A]> {
  // The CMS rejects with an empty "[ExtensionService] Failed to invoke function:" when the
  // backend throws instead of answering.
  const response = await context.extension.invokeFunction(CMS_EXTENSION_FUNCTION_ID, {action, params}).catch(() => {
    throw new CallError('backend_unreachable', FALLBACK_MESSAGES.backend_unreachable);
  });
  const envelope = response.data as Envelope<ActionResults[A]> | undefined;
  if (envelope && typeof envelope === 'object' && 'ok' in envelope) {
    if (envelope.ok) return envelope.result;
    throw new CallError(envelope.error, envelope.message || FALLBACK_MESSAGES[envelope.error] || GENERIC_MESSAGE);
  }
  throw new CallError('request_failed', 'The Share preview app sent an answer it could not read. Try again.');
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : GENERIC_MESSAGE;
}
