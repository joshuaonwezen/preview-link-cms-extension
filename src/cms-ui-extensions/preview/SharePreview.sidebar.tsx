import {
  Alert,
  AxiomProvider,
  Badge,
  Box,
  Button,
  Disclosure,
  DisclosureContent,
  DisclosureTrigger,
  Group,
  Heading,
  Separator,
  Spinner,
  Text,
} from '@optiaxiom/react';
import {register, type ContentState, type ExtensionContext} from '@optimizely/cms-extensibility-sdk';
import {normalizeKey} from '@shared/constants';
import type {ContentRef, LinkCheck, LinksResult, ShareLink} from '@shared/types';
import {statusBadge} from '@shared/versionStatus';
import {useCallback, useEffect, useRef, useState, type ReactNode} from 'react';

import {call, CallError, errorMessage} from '../common/api';
import {CopyButton} from '../common/CopyButton';
import {OpenLink} from '../common/OpenLink';

function toRef(state: ContentState): ContentRef | null {
  if (!state?.key) return null;
  return {key: state.key, locale: state.locale ?? '', version: state.version};
}

function sameRef(a: ContentRef | null, b: ContentRef | null): boolean {
  return a?.key === b?.key && a?.locale === b?.locale && a?.version === b?.version;
}

function errorCode(error: Error): string | null {
  return error instanceof CallError ? error.code : null;
}

// Things to sort out rather than failures: missing settings, a language or version the
// CMS doesn't have, an item that was deleted.
const WARNINGS = new Set(['not_configured', 'locale_missing', 'locale_mismatch', 'content_missing', 'version_missing']);
// Retrying can't change these: the item is an image or folder, or it is gone.
const NO_RETRY = new Set(['unsupported_content', 'content_missing']);

// An image or folder isn't a failure, just nothing the site can render.
function alertIntent(error: Error): 'information' | 'warning' | 'danger' {
  const code = errorCode(error);
  if (code === 'unsupported_content') return 'information';
  if (code && WARNINGS.has(code)) return 'warning';
  return 'danger';
}

function describe(link: ShareLink): ReactNode {
  return link.variation ? (
    <>
      Variation <code>{link.variation}</code>
    </>
  ) : (
    'Original page'
  );
}

function VersionBadge({status}: {status: string}) {
  const badge = statusBadge(status);
  if (!badge) return null;
  return (
    <Badge intent={badge.intent} variant="subtle">
      {badge.label}
    </Badge>
  );
}

type CheckState =
  | {version: string; state: 'checking'}
  | {version: string; state: 'done'; result: LinkCheck}
  | {version: string; state: 'error'; message: string};

const NOT_OPENING =
  "The site couldn't open this preview. A draft you just saved can take a few seconds; check again. If it keeps " +
  'failing, ask a CMS admin to check the site URL and preview secret in the app settings.';

function CheckLine({check, onCheckAgain}: {check: CheckState; onCheckAgain: () => void}) {
  if (check.state === 'checking') {
    return (
      <Group alignItems="center" gap="8">
        <Spinner size="sm" />
        <Text color="fg.secondary" fontSize="xs">Checking that the link opens on the site...</Text>
      </Group>
    );
  }
  if (check.state === 'done' && check.result.ok) {
    return <Text color="fg.success" fontSize="xs">Opens on the site.</Text>;
  }
  return (
    <Group alignItems="start" flexDirection="column" gap="4">
      <Text color="fg.warning" fontSize="xs">{check.state === 'error' ? check.message : NOT_OPENING}</Text>
      <Button appearance="subtle" onClick={onCheckAgain} size="sm">Check again</Button>
    </Group>
  );
}

interface CurrentLinkProps {
  link: ShareLink;
  check: CheckState | null;
  onCheckAgain: () => void;
}

function CurrentLink({link, check, onCheckAgain}: CurrentLinkProps) {
  return (
    <Group flexDirection="column" gap="8">
      <Group alignItems="center" gap="8">
        <Text fontSize="sm" fontWeight="500">This version</Text>
        <VersionBadge status={link.status} />
      </Group>
      <Group alignItems="start" gap="8">
        <CopyButton appearance="primary" text={link.url} />
        <OpenLink url={link.url}>Open</OpenLink>
      </Group>
      <Text color="fg.secondary" fontSize="xs">
        Anyone with this link can see this version, without a CMS login.
      </Text>
      {check && <CheckLine check={check} onCheckAgain={onCheckAgain} />}
    </Group>
  );
}

function LinkRow({link}: {link: ShareLink}) {
  return (
    <Group alignItems="center" gap="8" justifyContent="space-between">
      <Group alignItems="start" flexDirection="column" gap="2" style={{flex: 1, minWidth: 0}}>
        <Text fontSize="sm" truncate>
          {describe(link)}
        </Text>
        <VersionBadge status={link.status} />
      </Group>
      <Group alignItems="start" gap="4">
        <CopyButton appearance="subtle" label="Copy" size="sm" text={link.url} />
        <OpenLink appearance="subtle" size="sm" url={link.url}>
          Open
        </OpenLink>
      </Group>
    </Group>
  );
}

function SharePreview({context}: {context: ExtensionContext}) {
  const [contentRef, setContentRef] = useState<ContentRef | null>(null);
  const [links, setLinks] = useState<LinksResult | null>(null);
  const [loadError, setLoadError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(false);
  const [check, setCheck] = useState<CheckState | null>(null);
  const requestId = useRef(0);
  const checkId = useRef(0);

  // A check's answer is dropped once the links it belongs to were reloaded, or once a
  // newer check started.
  const runCheck = useCallback(
    async (ref: ContentRef, version: string) => {
      const linksId = requestId.current;
      const id = ++checkId.current;
      const stillCurrent = () => id === checkId.current && linksId === requestId.current;
      setCheck({version, state: 'checking'});
      try {
        const result = await call(context, 'checkLink', {content: ref, version});
        if (stillCurrent()) setCheck({version, state: 'done', result});
      } catch (error) {
        if (stillCurrent()) setCheck({version, state: 'error', message: errorMessage(error)});
      }
    },
    [context],
  );

  const refresh = useCallback(
    async (ref: ContentRef) => {
      const id = ++requestId.current;
      setLoading(true);
      setCheck(null);
      try {
        const next = await call(context, 'getLinks', {content: ref});
        if (id !== requestId.current) return;
        setLinks(next);
        setLoadError(null);
        if (next.current) void runCheck(ref, next.current.version);
      } catch (error) {
        if (id !== requestId.current) return;
        setLinks(null);
        setLoadError(error as Error);
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    },
    [context, runCheck],
  );

  useEffect(() => {
    void context.extension.setReady();
    const apply = (state: ContentState) => {
      const next = toRef(state);
      setContentRef((prev) => (sameRef(prev, next) ? prev : next));
    };
    void context.content.get().then(apply);
    return context.content.subscribe(apply);
  }, [context]);

  // Switching variation in the editor changes the version, so this also re-signs the link.
  useEffect(() => {
    if (contentRef) {
      void refresh(contentRef);
    } else {
      setLinks(null);
      setLoadError(null);
    }
  }, [contentRef, refresh]);

  const onRetry = useCallback(() => {
    if (contentRef) void refresh(contentRef);
  }, [contentRef, refresh]);

  const onCheckAgain = useCallback(() => {
    if (contentRef && links?.current) void runCheck(contentRef, links.current.version);
  }, [contentRef, links, runCheck]);

  // Between switching items and the new links arriving, `links` still describes the
  // previous item; hold it back so a link for the wrong page is never shown. Switching
  // variation keeps the item but changes the version, and until the new link arrives the
  // old one would share the variation the editor just left.
  const sameItem =
    links && contentRef && links.content.key === normalizeKey(contentRef.key) &&
    (!contentRef.locale || links.content.locale === contentRef.locale);
  const current = sameItem && links && (!contentRef?.version || links.current?.version === contentRef.version);

  const open = current && links ? links.current : null;
  const others = current && links ? links.latest.filter((link) => link.version !== open?.version) : [];

  return (
    <Box p="12">
      <Group flexDirection="column" gap="12">
        {sameItem && links && (
          <Group flexDirection="column" gap="4">
            <Group alignItems="center" justifyContent="space-between">
              <Heading level="4">{links.content.displayName || 'Untitled page'}</Heading>
              {loading && <Spinner size="sm" />}
            </Group>
            {open && (
              <Text color="fg.secondary" fontSize="sm">
                {open.variation ? (
                  <>
                    Editing variation <code>{open.variation}</code>
                  </>
                ) : (
                  'Editing the original page'
                )}
              </Text>
            )}
          </Group>
        )}

        {!contentRef && <Text color="fg.secondary">Open a page to share a preview of it.</Text>}
        {loadError && contentRef && (
          <Alert intent={alertIntent(loadError)}>
            <Group flexDirection="column" gap="8">
              <Text fontSize="sm">{errorMessage(loadError)}</Text>
              {errorCode(loadError) === 'not_configured' && (
                <Text fontSize="sm">
                  Ask a CMS admin to fill these in on the Share preview app&apos;s settings page.
                </Text>
              )}
              {!NO_RETRY.has(errorCode(loadError) ?? '') && (
                <Button onClick={onRetry} size="sm">Retry</Button>
              )}
            </Group>
          </Alert>
        )}
        {contentRef && loading && !sameItem && <Spinner />}

        {current && links && (
          <>
            {open ? (
              <CurrentLink
                check={check?.version === open.version ? check : null}
                link={open}
                onCheckAgain={onCheckAgain}
              />
            ) : links.latest.length > 0 ? (
              <Text color="fg.secondary" fontSize="sm">
                The editor didn&apos;t say which version is open. Pick one below.
              </Text>
            ) : (
              <Text color="fg.secondary" fontSize="sm">
                This page has no saved version to share yet.
              </Text>
            )}

            {others.length > 0 && (
              <>
                {open && <Separator />}
                <Disclosure defaultOpen={!open} key={`${links.content.key}:${links.content.locale}`}>
                  <DisclosureTrigger>
                    {open ? 'Other variations' : 'Variations'} ({others.length})
                  </DisclosureTrigger>
                  <DisclosureContent>
                    <Group flexDirection="column" gap="8" pt="8">
                      <Text color="fg.secondary" fontSize="xs">
                        The newest version of the original page and of each variation.
                      </Text>
                      {others.map((link) => (
                        <LinkRow key={link.version} link={link} />
                      ))}
                    </Group>
                  </DisclosureContent>
                </Disclosure>
              </>
            )}
          </>
        )}
      </Group>
    </Box>
  );
}

register((context) => (
  <AxiomProvider>
    <SharePreview context={context} />
  </AxiomProvider>
));
