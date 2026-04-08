// Git service — abstracts git protocol commands (M1-03, M5-03, M5-04)

import type { ConflictResolution } from '../../types/protocol';
import type { CommandBus } from '../commands/commandBus';

export class GitService {
  private readonly bus: CommandBus;

  constructor(bus: CommandBus) {
    this.bus = bus;
  }

  getRepoStatus(): void {
    this.bus.dispatch({ type: 'GetRepoStatus' });
  }

  getCommitHistory(limit = 50): void {
    this.bus.dispatch({ type: 'GetCommitHistory', limit });
  }

  stageFile(path: string): void {
    this.bus.dispatch({ type: 'StageFile', path });
  }

  unstageFile(path: string): void {
    this.bus.dispatch({ type: 'UnstageFile', path });
  }

  createCommit(message: string): void {
    this.bus.dispatch({ type: 'CreateCommit', message });
  }

  checkoutBranch(name: string): void {
    this.bus.dispatch({ type: 'CheckoutBranch', name });
  }

  createBranch(name: string, from?: string): void {
    this.bus.dispatch({ type: 'CreateBranch', name, from });
  }

  getChangedFiles(mode: 'working' | 'run', runId?: string): void {
    this.bus.dispatch({ type: 'GetChangedFiles', mode, run_id: runId });
  }

  getFileDiff(filePath: string, mode: 'working' | 'run', runId?: string): void {
    this.bus.dispatch({ type: 'GetFileDiff', file_path: filePath, mode, run_id: runId });
  }

  listStashes(): void {
    this.bus.dispatch({ type: 'ListStashes' });
  }

  getStashFiles(stashIndex: number): void {
    this.bus.dispatch({ type: 'GetStashFiles', stash_index: stashIndex });
  }

  getStashDiff(stashIndex: number, filePath?: string): void {
    this.bus.dispatch({ type: 'GetStashDiff', stash_index: stashIndex, file_path: filePath ?? null });
  }

  pushBranch(remote?: string, branch?: string): void {
    this.bus.dispatch({ type: 'PushBranch', remote, branch });
  }

  pullBranch(remote?: string, branch?: string): void {
    this.bus.dispatch({ type: 'PullBranch', remote, branch });
  }

  fetchRemote(remote?: string): void {
    this.bus.dispatch({ type: 'FetchRemote', remote });
  }

  getMergeConflicts(): void {
    this.bus.dispatch({ type: 'GetMergeConflicts' });
  }

  resolveConflict(filePath: string, resolution: ConflictResolution): void {
    this.bus.dispatch({ type: 'ResolveConflict', file_path: filePath, resolution });
  }
}
