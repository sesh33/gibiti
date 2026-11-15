"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { workspaceBrand } from "@/lib/branding";
import { WorkspaceTransition } from "@/components/workspace-transition";
import {
  Activity,
  FileSpreadsheet,
  ArrowUpRight,
  Bell,
  Box,
  ChevronDown,
  Command,
  Gauge,
  Inbox,
  Layers3,
  MessageSquareText,
  Menu,
  X,
  LogOut,
  Search,
  Settings2,
  ShieldCheck,
  ShoppingBag,
  Users,
  Zap,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
const navigation = [
  {
    label: "Seller center",
    href: "/seller",
    icon: Bell,
    permission: "seller.read",
  },
  {
    label: "Reports & invoices",
    href: "/reports",
    icon: FileSpreadsheet,
    permission: "reports.export",
  },
  {
    label: "Batch workbench",
    href: "/offers/batch",
    icon: Layers3,
    permission: "offers.read",
  },
  {
    label: "Automation & pricing",
    href: "/automation",
    icon: Gauge,
    permission: "offers.update_price",
  },
  { label: "Reply library", href: "/templates", icon: MessageSquareText },
  {
    label: "Offers",
    href: "/offers",
    icon: Layers3,
    permission: "offers.read",
  },
  {
    label: "Order center",
    href: "/orders",
    icon: ShoppingBag,
    permission: "orders.read_assigned",
  },
  {
    label: "Inventory",
    href: "/inventory",
    icon: Box,
    permission: "inventory.read",
  },
  {
    label: "Overview",
    href: "/overview",
    icon: Gauge,
    permission: "analytics.read",
  },
  { label: "Team", href: "/team", icon: Users, permission: "team.read" },
  { label: "Approvals", href: "/approvals", icon: ShieldCheck },
  {
    label: "Activity log",
    href: "/activity",
    icon: Activity,
    permission: "audit.read",
  },
  {
    label: "Settings",
    href: "/settings",
    icon: Settings2,
    permission: "settings.manage",
  },
  {
    label: "Smart inbox",
    href: "/inbox",
    icon: Inbox,
    permission: "conversations.read",
  },
];
const operationPaths = new Set([
  "/orders",
  "/offers",
  "/inventory",
  "/overview",
  "/templates",
  "/seller",
  "/reports",
  "/offers/batch",
]);
const navigationOrder = [
  "/overview",
  "/orders",
  "/offers",
  "/offers/batch",
  "/inventory",
  "/templates",
  "/seller",
  "/reports",
  "/automation",
  "/team",
  "/approvals",
  "/activity",
  "/settings",
  "/inbox",
];
const compactQuery = "(max-width: 820px)";
function subscribeCompact(callback: () => void) {
  const media = window.matchMedia(compactQuery);
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
}
function compactSnapshot() {
  return window.matchMedia(compactQuery).matches;
}
export function WorkspaceShell({
  children,
  staff,
  configured,
}: {
  children: React.ReactNode;
  staff: { name: string; role: string; permissions: string[] } | null;
  configured: boolean;
}) {
  const pathname = usePathname(),
    router = useRouter(),
    queryClient = useQueryClient();
  const [searchOpen, setSearchOpen] = useState(false),
    [query, setQuery] = useState(""),
    [notifications, setNotifications] = useState(false),
    [loggingOut, setLoggingOut] = useState(false),
    [logoutError, setLogoutError] = useState(""),
    [mobileOpen, setMobileOpen] = useState(false);
  const compact = useSyncExternalStore(
    subscribeCompact,
    compactSnapshot,
    () => false,
  );
  const menuRef = useRef<HTMLButtonElement>(null),
    closeMenuRef = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    if (compact && mobileOpen)
      closeMenuRef.current?.focus({ preventScroll: true });
  }, [compact, mobileOpen]);
  useEffect(() => {
    if (!compact || !mobileOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const trigger = menuRef.current;
    return () => {
      document.body.style.overflow = previousOverflow;
      if (
        trigger?.isConnected &&
        !document.querySelector('[role="dialog"][data-state="open"]')
      )
        trigger.focus({ preventScroll: true });
    };
  }, [compact, mobileOpen]);
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    function keyboard(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key === "k") {
        event.preventDefault();
        setMobileOpen(false);
        setSearchOpen((value) => !value);
      }
      if (event.key === "Escape") {
        setNotifications(false);
        setMobileOpen(false);
      }
    }
    window.addEventListener("keydown", keyboard);
    return () => window.removeEventListener("keydown", keyboard);
  }, []);
  const visible = navigation
    .filter(
      (item) =>
        !staff ||
        !item.permission ||
        staff.permissions.includes(item.permission) ||
        (item.href === "/orders" &&
          staff.permissions.includes("orders.read")) ||
        (item.href === "/inventory" &&
          staff.permissions.includes("inventory.manage")),
    )
    .sort(
      (a, b) =>
        navigationOrder.indexOf(a.href) - navigationOrder.indexOf(b.href),
    );
  const workspaceNavigation = visible.filter((item) =>
    operationPaths.has(item.href),
  );
  const managementNavigation = visible.filter(
    (item) => !operationPaths.has(item.href) && item.href !== "/inbox",
  );
  const unavailableNavigation = visible.filter(
    (item) => item.href === "/inbox",
  );
  const current = [...visible]
    .sort((a, b) => b.href.length - a.href.length)
    .find(
      (item) => pathname === item.href || pathname.startsWith(item.href + "/"),
    );
  const canSearchOrders =
    !staff ||
    staff.permissions.includes("orders.read") ||
    staff.permissions.includes("orders.read_assigned");
  const canManageSettings =
    !staff || staff.permissions.includes("settings.manage");
  const initials = staff?.name.slice(0, 2).toUpperCase() ?? "RX";
  const currentTitle =
    pathname === "/offers/import"
      ? "Import listings"
      : pathname === "/offers/edit"
        ? "Offer editor"
        : pathname.startsWith("/orders/")
          ? "Order details"
          : (current?.label ?? "Workspace");
  const commands = [
    ...visible,
    ...(!staff || staff.permissions.includes("offers.create")
      ? [
          {
            href: "/offers/import",
            label: "Import listings",
            icon: FileSpreadsheet,
          },
          { href: "/offers/edit", label: "Create an offer", icon: Layers3 },
        ]
      : []),
  ];
  function trapNavigationFocus(event: React.KeyboardEvent<HTMLElement>) {
    if (!compact || !mobileOpen || event.key !== "Tab") return;
    const controls = [
      ...event.currentTarget.querySelectorAll<HTMLElement>(
        "a[href],button:not([disabled])",
      ),
    ].filter((item) => item.getClientRects().length > 0);
    const first = controls[0],
      last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }
  async function logout() {
    setLoggingOut(true);
    setLogoutError("");
    try {
      const response = await fetch("/api/auth/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!response.ok) throw new Error("Sign-out failed");
      queryClient.clear();
      router.push("/login");
      router.refresh();
    } catch {
      setLogoutError(
        "Sign-out failed. Your session may still be active. Please try again.",
      );
    } finally {
      setLoggingOut(false);
    }
  }
  return (
    <div
      className="app-shell"
      data-navigation-open={compact && mobileOpen ? "true" : "false"}
    >
      <a className="skip-link" href="#workspace-content">
        Skip to content
      </a>
      {compact && mobileOpen && (
        <button
          className="navigation-scrim"
          aria-label="Close navigation overlay"
          tabIndex={-1}
          onClick={() => setMobileOpen(false)}
        />
      )}
      <aside
        className="sidebar"
        id="workspace-navigation"
        inert={compact && !mobileOpen ? true : undefined}
        aria-hidden={compact && !mobileOpen ? true : undefined}
        onKeyDown={trapNavigationFocus}
      >
        <div className="sidebar-brand-row">
          <Link
            href="/"
            className="wordmark"
            onClick={() => setMobileOpen(false)}
          >
            <span className="brand-symbol">
              <Zap size={20} fill="currentColor" />
            </span>
            <span className="brand-name" title={workspaceBrand.name}>
              {workspaceBrand.name}
            </span>
            <span className="wordmark-sub">CONTROL</span>
          </Link>
          <button
            ref={closeMenuRef}
            className="navigation-close icon-button"
            aria-label="Close navigation"
            onClick={() => setMobileOpen(false)}
          >
            <X size={20} />
          </button>
        </div>
        <button
          className="workspace-switch"
          aria-label="Workspace settings"
          disabled={!canManageSettings}
          onClick={() => {
            setMobileOpen(false);
            router.push("/settings");
          }}
        >
          <span className="workspace-logo">{workspaceBrand.initial}</span>
          <span>
            {workspaceBrand.organization}
            <small>Private operations</small>
          </span>
          <ChevronDown size={13} />
        </button>
        <span className="nav-section">OPERATIONS</span>
        <nav aria-label="Primary navigation">
          {workspaceNavigation.map((item) => (
            <Link
              key={item.href}
              aria-label={item.label}
              aria-current={current?.href === item.href ? "page" : undefined}
              title={item.label}
              className={
                current?.href === item.href ? "nav-link active" : "nav-link"
              }
              href={item.href}
              onClick={() => setMobileOpen(false)}
            >
              <item.icon size={17} />
              <span>{item.label}</span>
              {current?.href === item.href && (
                <span className="nav-active-dot" />
              )}
            </Link>
          ))}
          {managementNavigation.length > 0 && (
            <span className="nav-section nav-second">MANAGEMENT</span>
          )}
          {managementNavigation.map((item) => (
            <Link
              key={item.href}
              aria-label={item.label}
              aria-current={current?.href === item.href ? "page" : undefined}
              title={item.label}
              className={
                current?.href === item.href ? "nav-link active" : "nav-link"
              }
              href={item.href}
              onClick={() => setMobileOpen(false)}
            >
              <item.icon size={17} />
              <span>{item.label}</span>
            </Link>
          ))}
          {unavailableNavigation.length > 0 && (
            <span className="nav-section nav-second">UNAVAILABLE</span>
          )}
          {unavailableNavigation.map((item) => (
            <Link
              key={item.href}
              aria-label={item.label}
              aria-current={current?.href === item.href ? "page" : undefined}
              title="Unavailable: buyer messaging is not included in the Eldorado Seller API."
              className={
                current?.href === item.href ? "nav-link active" : "nav-link"
              }
              href={item.href}
              onClick={() => setMobileOpen(false)}
            >
              <item.icon size={17} />
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-status">
            <ShieldCheck size={15} aria-hidden="true" />
            <span>
              Private seller operations
              <small>Individual access. Shared control.</small>
            </span>
          </div>
          <div className="profile">
            <span className="avatar">{initials}</span>
            <span>
              {staff?.name ?? "Workspace setup"}
              <small>
                {staff?.role === "OWNER"
                  ? "Owner · Full control"
                  : (staff?.role.replaceAll("_", " ") ??
                    "Authentication required")}
              </small>
            </span>
            {staff && (
              <button
                onClick={logout}
                aria-label={loggingOut ? "Signing out" : "Sign out"}
                disabled={loggingOut}
              >
                <LogOut size={15} />
              </button>
            )}
          </div>
          {logoutError && (
            <p role="alert" className="logout-error">
              {logoutError}
            </p>
          )}
        </div>
      </aside>
      <div
        className="main-shell"
        inert={compact && mobileOpen ? true : undefined}
      >
        <header className="topbar">
          <div className="topbar-leading">
            <button
              ref={menuRef}
              className="navigation-toggle icon-button"
              aria-label="Open navigation"
              aria-expanded={compact && mobileOpen}
              aria-controls="workspace-navigation"
              onClick={() => setMobileOpen(true)}
            >
              <Menu size={21} />
            </button>
            <div className="breadcrumbs">
              Workspace <span>/</span> <strong>{currentTitle}</strong>
            </div>
          </div>
          <div className="topbar-actions">
            <button
              className="global-search"
              aria-label="Open command search"
              onClick={() => setSearchOpen(true)}
            >
              <Search size={14} />
              <span>Jump to anything...</span>
              <kbd>⌘ K</kbd>
            </button>
            <span className="topbar-divider" />
            <button
              className="icon-button"
              aria-label="Operational alerts"
              aria-expanded={notifications}
              aria-controls="operational-alerts"
              onClick={() => setNotifications((value) => !value)}
            >
              <Bell size={17} />
            </button>
            <span
              className="topbar-avatar"
              aria-label={staff ? `${staff.name} profile` : "Workspace setup"}
            >
              {initials}
            </span>
          </div>
          {notifications && (
            <div
              id="operational-alerts"
              className="notification-panel"
              role="region"
              aria-label="Operational alerts"
            >
              <strong>Operational alerts</strong>
              <p>Buyer messaging is not included in the Eldorado Seller API.</p>
              {!configured && (
                <p>Configure Supabase before inviting your team.</p>
              )}
              {canManageSettings ? (
                <Link href="/settings" onClick={() => setNotifications(false)}>
                  View integration status <ArrowUpRight size={12} />
                </Link>
              ) : (
                <p>
                  Your Owner manages integration access. Your staff permissions
                  remain in effect.
                </p>
              )}
            </div>
          )}
        </header>
        {!configured && (
          <div className="setup-banner">
            <ShieldCheck size={14} />
            <span>
              Secure setup required. No live account data is being displayed.
            </span>
            <Link href="/settings">
              Configure workspace <ArrowUpRight size={12} />
            </Link>
          </div>
        )}
        <main className="page-content" id="workspace-content" tabIndex={-1}>
          <WorkspaceTransition>{children}</WorkspaceTransition>
        </main>
        <footer className="workspace-footer">
          <span>
            <span className="status-dot" /> {workspaceBrand.name} CONTROL{" "}
            <span className="footer-version">/ Seller operations suite</span>
          </span>
          <span>Private by design. Precise by default.</span>
        </footer>
      </div>
      <Dialog open={searchOpen} onOpenChange={setSearchOpen}>
        <DialogContent>
          <DialogTitle>Jump to your workspace</DialogTitle>
          <DialogDescription>
            Navigate modules or search synchronized orders.
          </DialogDescription>
          <label className="input-search command-input">
            <Search size={17} />
            <input
              ref={searchRef}
              aria-label="Search workspace"
              autoFocus
              placeholder="Search pages, buyers, or products..."
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <Command size={14} />
          </label>
          <div className="command-results">
            {commands
              .filter((item) =>
                item.label.toLowerCase().includes(query.toLowerCase()),
              )
              .map((item) => (
                <Link
                  onClick={() => {
                    setMobileOpen(false);
                    setSearchOpen(false);
                  }}
                  href={item.href}
                  key={item.href}
                >
                  <item.icon size={16} />
                  {item.label}
                  {item.href === "/inbox" && " · unavailable"}
                  <ArrowUpRight size={13} />
                </Link>
              ))}
            {query && canSearchOrders && (
              <Link
                href={`/orders?search=${encodeURIComponent(query)}`}
                onClick={() => {
                  setMobileOpen(false);
                  setSearchOpen(false);
                }}
              >
                <Search size={16} />
                Search orders for “{query}”<ArrowUpRight size={13} />
              </Link>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
