"use client";
import * as React from "react";
export const PortalCtx = React.createContext<{ me: any; reload: () => void; lang: "es" | "en"; setLang: (l: "es" | "en") => void }>({ me: null, reload: () => {}, lang: "es", setLang: () => {} });
export const usePortal = () => React.useContext(PortalCtx);
