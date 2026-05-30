/// <reference types="vite/client" />

import type { KikiApi } from "../preload";

declare global {
  interface Window {
    kiki: KikiApi;
  }
}
