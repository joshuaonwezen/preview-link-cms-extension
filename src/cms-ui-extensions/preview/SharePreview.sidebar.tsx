import {Alert, AxiomProvider, Box, Button, Group, Heading, Separator, Spinner, Text} from '@optiaxiom/react';
import {register, type ContentState, type ExtensionContext} from '@optimizely/cms-extensibility-sdk';
import {normalizeKey} from '@shared/constants';
import type {ContentRef, LinkCheck, LinksResult, ShareLink} from '@shared/types';
import {useCallback, useEffect, useRef, useState, type ReactNode} from 'react';

import {call, CallError, errorMessage} from '../common/api';
import {CopyButton} from '../common/CopyButton';
import {OpenLink} from '../common/OpenLink';

function toRef(state: ContentState): ContentRef | null {
  if (!state?.key) return null;
  return {key: state.key, locale: state.locale ?? '', version: state.version, publicUrl: state.publicUrl};
}

function sameRef(a: ContentRef | null, b: ContentRef | null): boolean {
  return a?.key === b?.key && a?.locale === b?.locale && a?.version === b?.version && a?.publicUrl === b?.publicUrl;
}

function errorCode(error: Error): string | null {
  return error instanceof CallError ? error.code : null;
}

// An image or folder isn't a failure, just nothing the site can render.
function alertIntent(error: Error): 'information' | 'warning' | 'danger' {
  const code = errorCode(error);
  if (code === 'unsupported_content') return 'information';
  if (code === 'not_configured' || code === 'locale_missing') return 'warning';
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

type CheckState =
  | {version: string; state: 'checking'}
  | {version: string; state: 'done'; result: LinkCheck}
  | {version: string; state: 'error'; message: string};

function CheckLine({check}: {check: CheckState}) {
  if (check.state === 'checking') {
    return (
      <Group alignItems="center" gap="8">
        <Spinner size="sm" />
        <Text color="fg.secondary" fontSize="xs">Checking that the link opens on the site...</Text>
      </Group>
    );
  }
  if (check.state === 'error') return <Text color="fg.warning" fontSize="xs">{check.message}</Text>;
  if (check.result.ok) return <Text color="fg.success" fontSize="xs">Opens on the site.</Text>;
  if (check.result.status === 404) {
    return (
      <Text color="fg.warning" fontSize="xs">
        The site answered 404. Check the site URL and preview secret in the app settings. A draft you just saved can
        also take a few seconds to reach Graph.
      </Text>
    );
  }
  return <Text color="fg.warning" fontSize="xs">The site answered HTTP {check.result.status}.</Text>;
}

function LinkCard({link, check}: {link: ShareLink; check: CheckState | null}) {
  return (
    <Group flexDirection="column" gap="8">
      <Text fontSize="sm">
        {describe(link)} · version {link.version} · {link.status}
      </Text>
      <Text color="fg.secondary" fontSize="xs" style={{overflowWrap: 'anywhere', userSelect: 'all'}}>
        {link.url}
      </Text>
      <Group alignItems="start" gap="8">
        <CopyButton appearance="primary" text={link.url} />
        <OpenLink url={link.url}>Open</OpenLink>
      </Group>
      {check && <CheckLine check={check} />}
    </Group>
  );
}

function LinkRow({link, isOpen}: {link: ShareLink; isOpen: boolean}) {
  return (
    <Group alignItems="center" gap="8" justifyContent="space-between">
      <Group flexDirection="column" gap="2" style={{flex: 1, minWidth: 0}}>
        <Text fontSize="sm" truncate>
          {describe(link)}
        </Text>
        <Text color="fg.secondary" fontSize="xs">
          version {link.version} · {link.status}
          {isOpen ? ' · open in the editor' : ''}
        </Text>
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

  const runCheck = useCallback(
    async (ref: ContentRef, version: string, id: number) => {
      setCheck({version, state: 'checking'});
      try {
        const result = await call(context, 'checkLink', {content: ref, version});
        if (id === requestId.current) setCheck({version, state: 'done', result});
      } catch (error) {
        if (id === requestId.current) setCheck({version, state: 'error', message: errorMessage(error)});
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
        if (next.current) void runCheck(ref, next.current.version, id);
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

  // Between switching items and the new links arriving, `links` still describes the
  // previous item; hold it back so a link for the wrong page is never shown.
  const current =
    links && contentRef && links.content.key === normalizeKey(contentRef.key) &&
    (!contentRef.locale || links.content.locale === contentRef.locale);

  return (
    <Box p="12">
      <Group flexDirection="column" gap="12">
        {current && links && (
          <Group alignItems="center" justifyContent="space-between">
            <Heading level="4">{links.content.displayName}</Heading>
            {loading && <Spinner size="sm" />}
          </Group>
        )}

        {!contentRef && <Text color="fg.secondary">Open a page to share a preview of it.</Text>}
        {loadError && contentRef && (
          <Alert intent={alertIntent(loadError)}>
            <Group flexDirection="column" gap="8">
              <Text fontSize="sm">{errorMessage(loadError)}</Text>
              {errorCode(loadError) === 'not_configured' && (
                <Text fontSize="sm">Fill these in on the Share preview app&apos;s settings page.</Text>
              )}
              {errorCode(loadError) !== 'unsupported_content' && (
                <Button onClick={() => void refresh(contentRef)} size="sm">Retry</Button>
              )}
            </Group>
          </Alert>
        )}
        {contentRef && loading && !current && <Spinner />}

        {current && links && (
          <>
            {links.current ? (
              <Group flexDirection="column" gap="8">
                <Text fontSize="sm" fontWeight="500">This version</Text>
                <LinkCard check={check?.version === links.current.version ? check : null} link={links.current} />
              </Group>
            ) : (
              <Text color="fg.secondary" fontSize="sm">
                The editor didn&apos;t say which version is open. Pick one below.
              </Text>
            )}
            <Text color="fg.secondary" fontSize="xs">
              Anyone with the link sees exactly this version, its content and its variation, without a CMS login. The
              link doesn&apos;t expire and doesn&apos;t follow later edits, so share a new one after you change the
              page. Rotating the site&apos;s preview secret revokes every link.
            </Text>

            {links.latest.length > 0 && (
              <>
                <Separator />
                <Text fontSize="sm" fontWeight="500">Newest version of each variation</Text>
                {links.latest.map((link) => (
                  <LinkRow isOpen={link.version === links.current?.version} key={link.version} link={link} />
                ))}
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
