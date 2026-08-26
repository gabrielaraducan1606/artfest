// src/components/AIAssistant/CurrentEntityContext.jsx

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

/*
 * Context PARTAJAT între paginile rutate (<Outlet/>) și widget-urile
 * copilot (VendorAssistant/AiAssistant), montate ca FRAȚI în
 * AppLayout.jsx - nu prop-drilling prin router, ci un canal simplu
 * prin care o pagină poate "anunța" ce entitate are deschisă chiar
 * acum (ex. produsul din modalul de editare, pentru care URL-ul NU
 * conține id-ul - vezi /vendor/catalog, care nu are rută per produs).
 *
 * NU e sursă de autorizare - vezi backend/src/services/
 * vendorAssistantCommandService.js: orice id primit de-aici e doar
 * hint de rezolvare, ownership-ul se verifică din nou, mereu,
 * server-side.
 */
const CurrentEntityContext = createContext({
  currentEntity: null,
  setCurrentEntity: () => {},
  pageTypeOverride: null,
  setPageTypeOverride: () => {},
});

export function CurrentEntityProvider({ children }) {
  const [currentEntity, setCurrentEntity] = useState(null);
  const [pageTypeOverride, setPageTypeOverride] = useState(null);

  const value = useMemo(
    () => ({
      currentEntity,
      setCurrentEntity,
      pageTypeOverride,
      setPageTypeOverride,
    }),
    [currentEntity, pageTypeOverride]
  );

  return (
    <CurrentEntityContext.Provider value={value}>
      {children}
    </CurrentEntityContext.Provider>
  );
}

export function useCurrentEntityContext() {
  return useContext(CurrentEntityContext);
}

/*
 * Hook de conveniență pentru pagini: anunță o entitate cât timp
 * componenta e montată/entitatea e activă, o retrage automat la
 * unmount sau când entity devine null (ex. modalul de editare se
 * închide). entity = { type, id, name } sau null.
 */
export function useAnnounceCurrentEntity(entity) {
  const { setCurrentEntity } = useCurrentEntityContext();

  const type = entity?.type || null;
  const id = entity?.id || null;
  const name = entity?.name || null;

  useEffect(() => {
    if (!type || !id) {
      setCurrentEntity(null);
      return undefined;
    }

    setCurrentEntity({ type, id, name });

    return () => setCurrentEntity(null);
  }, [type, id, name, setCurrentEntity]);
}

/*
 * Hook de conveniență pentru pagini cu sub-secțiuni care NU sunt
 * reflectate în URL (ex. tab-ul Import de pe /vendor/catalog, ținut
 * strict în state React - vezi CatalogProduse.jsx) - suprascrie
 * DOAR pageType-ul derivat din pathname, pentru boost-ul de
 * knowledge retrieval.
 */
export function useAnnouncePageType(pageType) {
  const { setPageTypeOverride } = useCurrentEntityContext();

  useEffect(() => {
    setPageTypeOverride(pageType || null);
    return () => setPageTypeOverride(null);
  }, [pageType, setPageTypeOverride]);
}
