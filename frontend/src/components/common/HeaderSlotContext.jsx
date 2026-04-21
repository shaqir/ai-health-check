import { createContext, useCallback, useContext, useState } from 'react';

const HeaderSlotContext = createContext({ node: null, setNode: () => {} });

export function HeaderSlotProvider({ children }) {
  const [node, setNodeState] = useState(null);
  const setNode = useCallback((el) => setNodeState(el), []);
  return (
    <HeaderSlotContext.Provider value={{ node, setNode }}>
      {children}
    </HeaderSlotContext.Provider>
  );
}

export function useHeaderSlot() {
  return useContext(HeaderSlotContext);
}
