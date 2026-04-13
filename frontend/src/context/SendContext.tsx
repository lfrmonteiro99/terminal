import { createContext, useContext } from 'react';
import type { AppCommand } from '../types/protocol';

const SendContext = createContext<(cmd: AppCommand) => void>(() => {});

export const SendProvider = SendContext.Provider;

// eslint-disable-next-line react-refresh/only-export-components
export function useSend() {
  return useContext(SendContext);
}
