import { createContext, useContext } from 'react';
import type { AppCommand } from '../types/protocol';

const SendContext = createContext<(cmd: AppCommand) => void>(() => {});

export const SendProvider = SendContext.Provider;

export function useSend() {
  return useContext(SendContext);
}
