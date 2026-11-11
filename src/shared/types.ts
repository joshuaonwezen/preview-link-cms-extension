// The contract between the sidebar and the cms_extension function. The UI sends
// {action, params}; the function answers with an Envelope.

export type Envelope<T> =
  | {ok: true; result: T}
  | {ok: false; error: string; message?: string};

export interface ContentRef {
  key: string;
  locale: string;
  version?: string;
  /**
   * The page's address as the editor reports it (https only). Used only to tell which of
   * the CMS's sites the page is on; the backend never opens it.
   */
  publicUrl?: string;
}

export interface ShareLink {
  url: string;
  version: string;
  /** Null for the original page. */
  variation: string | null;
  /** The CMS version status: draft, published, previous, ... */
  status: string;
}

export interface LinksResult {
  /** `displayName` is '' when no version carries one. */
  content: {key: string; locale: string; displayName: string};
  /** The version open in the editor; null when the editor doesn't say which one. */
  current: ShareLink | null;
  /** The newest version of the original page and of each variation. */
  latest: ShareLink[];
}

export interface LinkCheck {
  /** The HTTP status the site answered the link with. */
  status: number;
  ok: boolean;
}

export type ActionParams = {
  getLinks: {content: ContentRef};
  checkLink: {content: ContentRef; version: string};
};

export type ActionResults = {
  getLinks: LinksResult;
  checkLink: LinkCheck;
};

export type ActionName = keyof ActionParams;
