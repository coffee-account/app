import { createContext, useContext } from "preact-htm";

/** Signed-in user, profile, linked person, settings and permission flags. */
export const AppContext = createContext(null);
export const useApp = () => useContext(AppContext);
