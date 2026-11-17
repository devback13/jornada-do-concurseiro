import { createContext, useContext } from 'react';

export const ConfigCtx = createContext({ config: null, reload: () => {} });
export const useConfig = () => useContext(ConfigCtx);
