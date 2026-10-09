// Nav panes — the rail's destinations, hosted in the pane surface.
//
// These are thin adapters. Every view below is prop-less and reads AppContext,
// so an adapter only has to give it a pane body: full height, its own scroll.
// The point is that navigation and the work now share one host: the same seven
// views used to render inside the sidebar's 220–460px panel on desktop *and*
// inside a separate full-surface overlay on a phone — two mechanisms for one
// concept. Both are gone; on a phone the pane switcher moves between them.
//
// `FileExplorer` is the odd one: it was declared as a PaneKind and given a label
// in `panes/labels.ts`, but nothing ever registered it. It is the rail's Files
// destination, so it is registered here.

import { registerPane } from '../registry';
import { OverviewView } from '../../components/sidebar/OverviewView';
import { RunsView } from '../../components/sidebar/RunsView';
import { ExplorerView } from '../../components/sidebar/ExplorerView';
import { GitView } from '../../components/sidebar/GitView';
import { AgentsView } from '../../components/sidebar/AgentsView';
import { SettingsView } from '../../components/SettingsView';

/**
 * The pane body these views were written against. The sidebar panel gave its
 * child `flex: 1` + `overflow-y: auto`, and both ExplorerView and GitView then
 * add a scroller of their own on top; reproducing that wrapper here is what
 * keeps the layouts identical to how they behaved in the panel.
 */
const BODY: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'auto',
};

export const OverviewPane = () => <div style={BODY}><OverviewView /></div>;
export const RunsPane = () => <div style={BODY}><RunsView /></div>;
export const FilesPane = () => <div style={BODY}><ExplorerView /></div>;
export const GitPane = () => <div style={BODY}><GitView /></div>;
export const AgentsPane = () => <div style={BODY}><AgentsView /></div>;
export const SettingsPane = () => <div style={BODY}><SettingsView /></div>;

registerPane('Overview', OverviewPane);
registerPane('Runs', RunsPane);
registerPane('FileExplorer', FilesPane);
registerPane('Git', GitPane);
registerPane('Agents', AgentsPane);
registerPane('Settings', SettingsPane);
