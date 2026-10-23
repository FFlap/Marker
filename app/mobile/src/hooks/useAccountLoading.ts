import { createContext, useContext } from 'react';

// Screens outside the startup boundary keep their existing authenticated behavior.
export const AccountLoadingContext = createContext({ profileReady: true, libraryReady: true });
export const useAccountLoading = () => useContext(AccountLoadingContext);
