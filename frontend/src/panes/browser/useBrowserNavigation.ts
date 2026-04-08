// Hook for "Open in Browser" flows from terminal/git/AI context (M6-02)

import { useCallback } from 'react';

export function useBrowserNavigation() {

  /**
   * Open a URL in the browser pane.
   * This signals the workspace to switch to a Browser pane with the given URL.
   * The workspace context manager handles the actual pane creation/focus.
   */
  const openInBrowser = useCallback((url: string) => {
    // In a full implementation this would dispatch a workspace action to
    // add/focus a BrowserPane with the given URL.
    // For now, open in a new browser tab as fallback.
    window.open(url, '_blank', 'noopener,noreferrer');
  }, []);

  /**
   * Open a localhost URL (e.g. from a running dev server in a terminal).
   */
  const openLocalServer = useCallback((port: number, path = '/') => {
    openInBrowser(`http://localhost:${port}${path}`);
  }, [openInBrowser]);

  /**
   * Open a GitHub/GitLab URL for the current repo.
   */
  const openRemoteUrl = useCallback((remoteUrl: string) => {
    // Convert git remote URLs (ssh/git protocol) to HTTPS for browser
    let webUrl = remoteUrl
      .replace(/^git@github\.com:/, 'https://github.com/')
      .replace(/^git@gitlab\.com:/, 'https://gitlab.com/')
      .replace(/\.git$/, '');
    openInBrowser(webUrl);
  }, [openInBrowser]);

  return { openInBrowser, openLocalServer, openRemoteUrl };
}
