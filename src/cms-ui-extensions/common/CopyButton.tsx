import {Button} from '@optiaxiom/react';
import {useEffect, useRef, useState} from 'react';

import {copyToClipboard} from './clipboard';

const NOTICE_MS = 1500;

/** Copies `text`; the label says "Copied" (or that it failed) for a moment. */
export function CopyButton({
  text,
  label = 'Copy link',
  appearance = 'default',
  size,
}: {
  text: string;
  label?: string;
  appearance?: 'default' | 'primary' | 'subtle';
  size?: 'sm' | 'md';
}) {
  const [copied, setCopied] = useState<boolean | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  const copy = async () => {
    const ok = await copyToClipboard(text);
    setCopied(ok);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(null), NOTICE_MS);
  };

  return (
    <Button appearance={appearance} onClick={() => void copy()} size={size}>
      {copied === true ? 'Copied' : copied === false ? 'Copy failed' : label}
    </Button>
  );
}
