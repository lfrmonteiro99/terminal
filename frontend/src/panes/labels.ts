// Human labels for pane kinds.
//
// Kept out of PaneRenderer on purpose: exporting a constant from a module that
// also exports components breaks React Fast Refresh (the module can no longer
// be hot-swapped), and the lint rule that catches it is worth obeying rather
// than suppressing.

export const PANE_LABELS: Record<string, string> = {
  Terminal: 'Terminal',
  AiRun: 'AI Run',
  GitStatus: 'Git Status',
  GitHistory: 'Git History',
  Browser: 'Browser',
  Diff: 'Diff',
  FileExplorer: 'Explorer',
  FileViewer: 'File',
  Search: 'Search',
  Empty: 'New Pane',
};