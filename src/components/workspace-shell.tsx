"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  ArrowUpRight,
  Bell,
  Box,
  ChevronDown,
  Command,
  Gauge,
  Inbox,
  Layers3,
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
    label: "Overview",
    href: "/overview",
    icon: Gauge,
    permission: "analytics.read",
  },
  {
    label: "Smart inbox",
    href: "/inbox",
    icon: Inbox,
    permission: "conversations.read",
  },
  {
    label: "Order center",
    href: "/orders",
    icon: ShoppingBag,
    permission: "orders.read_assigned",
  },
  {
    label: "Offers",
    href: "/offers",
    icon: Layers3,
    permission: "offers.read",
  },
  {
    label: "Inventory",
    href: "/inventory",
    icon: Box,
    permission: "inventory.read",
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
];
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
    [logoutError, setLogoutError] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    function keyboard(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key === "k") {
        event.preventDefault();
        setSearchOpen((value) => !value);
      }
      if (event.key === "Escape") setNotifications(false);
    }
    window.addEventListener("keydown", keyboard);
    return () => window.removeEventListener("keydown", keyboard);
  }, []);
  const visible = navigation.filter(
    (item) =>
      !staff ||
      !item.permission ||
      staff.permissions.includes(item.permission) ||
      (item.href === "/orders" && staff.permissions.includes("orders.read")) ||
      (item.href === "/inventory" &&
        staff.permissions.includes("inventory.manage")),
  );
  const workspaceNavigation = visible.filter(
    (item) => navigation.indexOf(item) < 5,
  );
  const managementNavigation = visible.filter(
    (item) => navigation.indexOf(item) >= 5,
  );
  const current = navigation.find((item) => pathname.startsWith(item.href));
  const canSearchOrders =
    !staff ||
    staff.permissions.includes("orders.read") ||
    staff.permissions.includes("orders.read_assigned");
  const canManageSettings =
    !staff || staff.permissions.includes("settings.manage");
  const initials = staff?.name.slice(0, 2).toUpperCase() ?? "RX";
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
    <div className="app-shell">
      <aside className="sidebar">
        <Link href="/" className="wordmark">
          <span className="brand-symbol">
            <Zap size={20} fill="currentColor" />
          </span>
          RIVOX<span className="wordmark-sub">CONTROL</span>
        </Link>
        <button
          className="workspace-switch"
          aria-label="Workspace settings"
          disabled={!canManageSettings}
          onClick={() => router.push("/settings")}
        >
          <span className="workspace-logo">R</span>
          <span>
            Rivox workspace<small>Private operations</small>
          </span>
          <ChevronDown size={13} />
        </button>
        <span className="nav-section">WORKSPACE</span>
        <nav aria-label="Primary navigation">
          {workspaceNavigation.map((item) => (
            <Link
              key={item.href}
              aria-label={item.label}
              aria-current={pathname.startsWith(item.href) ? "page" : undefined}
              title={item.label}
              className={
                pathname.startsWith(item.href) ? "nav-link active" : "nav-link"
              }
              href={item.href}
            >
              <item.icon size={17} />
              <span>{item.label}</span>
              {pathname.startsWith(item.href) && (
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
              aria-current={pathname.startsWith(item.href) ? "page" : undefined}
              title={item.label}
              className={
                pathname.startsWith(item.href) ? "nav-link active" : "nav-link"
              }
              href={item.href}
            >
              <item.icon size={17} />
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-status">
            <span className="status-dot amber" />
            <span>Messaging not connected</span>
            <ArrowUpRight size={12} />
          </div>
          <div className="profile">
            <span className="avatar">{initials}</span>
            <span>
              {staff?.name ?? "Workspace setup"}
              <small>
                {staff?.role.replaceAll("_", " ") ?? "Authentication required"}
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
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumbs">
            Workspace <span>/</span>{" "}
            <strong>{current?.label ?? "Order details"}</strong>
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
              <span className="notification-dot" />
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
              <p>Official messaging access is not connected.</p>
              {!configured && (
                <p>Configure Supabase before inviting your team.</p>
              )}
              <Link href="/settings" onClick={() => setNotifications(false)}>
                View integration status <ArrowUpRight size={12} />
              </Link>
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
        <main className="page-content">{children}</main>
        <footer className="workspace-footer">
          <span>
            <span className="status-dot" /> RIVOX CONTROL{" "}
            <span className="footer-version">/ v0.1 foundation</span>
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
            {visible
              .filter((item) =>
                item.label.toLowerCase().includes(query.toLowerCase()),
              )
              .map((item) => (
                <Link
                  onClick={() => setSearchOpen(false)}
                  href={item.href}
                  key={item.href}
                >
                  <item.icon size={16} />
                  {item.label}
                  <ArrowUpRight size={13} />
                </Link>
              ))}
            {query && canSearchOrders && (
              <Link
                href={`/orders?search=${encodeURIComponent(query)}`}
                onClick={() => setSearchOpen(false)}
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
