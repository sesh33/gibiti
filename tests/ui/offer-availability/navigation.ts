// Browser-only navigation shim for isolated component verification.
import { useSyncExternalStore } from "react";
const subscribe = (listener: () => void) => {
  window.addEventListener("popstate", listener);
  return () => window.removeEventListener("popstate", listener);
};
export function useSearchParams() {
  const search = useSyncExternalStore(subscribe, () => window.location.search);
  return new URLSearchParams(search);
}
export function usePathname() {
  return "/offers";
}
export function useRouter() {
  return {
    push(path: string) {
      window.history.pushState(null, "", path);
      window.dispatchEvent(new Event("popstate"));
    },
  };
}
