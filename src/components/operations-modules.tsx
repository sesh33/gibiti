"use client";
import { useState } from "react";
import { InventoryActions } from "@/components/inventory-actions";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Layers3, Plus, ShieldCheck, X } from "lucide-react";
import { api } from "@/lib/api-client";
import { money } from "@/lib/utils";
import {
  permissions,
  roles,
  type Role,
} from "@/domains/authorization/permissions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { PageHeading } from "@/components/page-heading";
import { EmptyState, QueryError } from "@/components/empty-state";

type Staff = {
  id: string;
  email: string;
  display_name: string;
  role: Role;
  active: boolean;
  user_permission_overrides: { permission: string; allowed: boolean }[];
};
type InventoryItem = {
  id: string;
  sku: string;
  title: string;
  category: string;
  status: string;
  inventory_reservations: {
    id: string;
    order_id: string;
    released_at: string | null;
  }[];
};
type Approval = {
  id: string;
  requester_id: string;
  action: string;
  target_id: string;
  reason: string;
  status: string;
  created_at: string;
  decision_reason: string | null;
  payload: {
    role?: string;
    active?: boolean;
    overrides?: { permission: string; allowed: boolean }[];
    operation?: string;
    reservation?: string;
  } | null;
};
export function TeamModule({ configured }: { configured: boolean }) {
  const cache = useQueryClient(),
    [open, setOpen] = useState(false),
    [editing, setEditing] = useState<Staff | null>(null),
    [name, setName] = useState(""),
    [email, setEmail] = useState(""),
    [role, setRole] = useState<Role>("SUPPORT_AGENT"),
    [active, setActive] = useState(true),
    [overrides, setOverrides] = useState<Record<string, string>>({}),
    [notice, setNotice] = useState(""),
    [changeReason, setChangeReason] = useState(""),
    [requestKey, setRequestKey] = useState("");
  const team = useQuery({
    queryKey: ["team"],
    queryFn: () => api<{ items: Staff[] }>("/api/team"),
    enabled: configured,
  });
  const mutation = useMutation({
    mutationFn: () =>
      editing
        ? api(`/api/team/${editing.id}`, {
            method: "PATCH",
            body: JSON.stringify({
              role,
              active,
              reason: changeReason,
              idempotencyKey: requestKey,
              overrides: Object.entries(overrides)
                .filter(([, value]) => value !== "default")
                .map(([permission, value]) => ({
                  permission,
                  allowed: value === "allow",
                })),
            }),
          })
        : api("/api/team", {
            method: "POST",
            body: JSON.stringify({ name, email, role }),
          }),
    onSuccess: () => {
      setOpen(false);
      setNotice(
        editing
          ? "Access change requested. A distinct authorized reviewer must approve it before permissions change."
          : "Invitation sent. The employee will use their own login.",
      );
      cache.invalidateQueries({ queryKey: ["team"] });
    },
    onError: (e) => setNotice(e.message),
  });
  function invite() {
    setEditing(null);
    setName("");
    setEmail("");
    setRole("SUPPORT_AGENT");
    setOpen(true);
  }
  function edit(user: Staff) {
    setRequestKey(crypto.randomUUID());
    setChangeReason("");
    setEditing(user);
    setName(user.display_name);
    setRole(user.role);
    setActive(user.active);
    setOverrides(
      Object.fromEntries(
        user.user_permission_overrides.map((p) => [
          p.permission,
          p.allowed ? "allow" : "deny",
        ]),
      ),
    );
    setOpen(true);
  }
  return (
    <>
      <PageHeading
        eyebrow="PEOPLE & ACCESS"
        title="Your team. Your rules."
        description="Individual accounts. Explicit permissions. No shared seller passwords."
      >
        <Button onClick={invite} disabled={!configured}>
          <Plus size={14} />
          Invite employee
        </Button>
      </PageHeading>
      <div className="info-banner">
        <ShieldCheck size={15} />
        <span>
          Owner-confirmed invitations. Permission changes require a separate
          MFA-verified reviewer.
        </span>
      </div>
      {notice && (
        <p className="inline-feedback" role="status">
          {notice}
        </p>
      )}
      <section className="data-panel">
        {team.isError ? (
          <QueryError message={team.error.message} />
        ) : (
          <>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Role</th>
                    <th>Access</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {team.data?.items.map((user) => (
                    <tr key={user.id}>
                      <td>
                        <strong className="table-primary">
                          {user.display_name}
                        </strong>
                        <small>{user.email}</small>
                      </td>
                      <td>
                        <span className="state-badge">
                          {user.role.replaceAll("_", " ")}
                        </span>
                      </td>
                      <td>
                        <span
                          className={`state-badge ${user.active ? "success" : ""}`}
                        >
                          {user.active ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => edit(user)}
                        >
                          Manage access
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!team.data?.items.length && (
              <EmptyState
                title="Built for a team. Secured for each person."
                description="Configure authentication, bootstrap the Owner, and invite employees with the least access they need."
                action={{ href: "/settings", label: "View secure setup" }}
              />
            )}
          </>
        )}
      </section>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogTitle>
            {editing ? "Manage employee access" : "Invite an employee"}
          </DialogTitle>
          <DialogDescription>
            {editing
              ? "A distinct authorized reviewer must approve access changes. You cannot change your own permissions or the Owner."
              : "An invitation will be sent by Supabase Auth. Only the Owner can assign an initial role."}
          </DialogDescription>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              mutation.mutate();
            }}
          >
            {!editing && (
              <>
                <label className="field-label">
                  Full name
                  <input
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={100}
                  />
                </label>
                <label className="field-label">
                  Email address
                  <input
                    required
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </label>
              </>
            )}
            <label className="field-label">
              Role
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as Role)}
              >
                {roles
                  .filter((r) => r !== "OWNER")
                  .map((r) => (
                    <option key={r} value={r}>
                      {r.replaceAll("_", " ")}
                    </option>
                  ))}
              </select>
            </label>
            {editing && (
              <>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={active}
                    onChange={(e) => setActive(e.target.checked)}
                  />
                  Account active
                </label>
                <details className="permission-editor">
                  <summary>Individual permission overrides</summary>
                  {permissions.map((permission) => (
                    <label key={permission}>
                      {permission}
                      <select
                        value={overrides[permission] ?? "default"}
                        onChange={(e) =>
                          setOverrides({
                            ...overrides,
                            [permission]: e.target.value,
                          })
                        }
                      >
                        <option value="default">Role default</option>
                        <option value="allow">Allow</option>
                        <option value="deny">Deny</option>
                      </select>
                    </label>
                  ))}
                </details>
                <label className="field-label">
                  Reason for the access change
                  <textarea
                    required
                    minLength={10}
                    maxLength={2000}
                    value={changeReason}
                    onChange={(e) => setChangeReason(e.target.value)}
                  />
                </label>
              </>
            )}
            <Button disabled={mutation.isPending} type="submit">
              {mutation.isPending
                ? "Saving..."
                : editing
                  ? "Request access change"
                  : "Send invitation"}
            </Button>
            {mutation.isError && (
              <p role="alert" className="form-error">
                {mutation.error.message}
              </p>
            )}
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
export function InventoryModule({ configured }: { configured: boolean }) {
  const cache = useQueryClient(),
    [open, setOpen] = useState(false),
    [reserve, setReserve] = useState<InventoryItem | null>(null),
    [sku, setSku] = useState(""),
    [title, setTitle] = useState(""),
    [category, setCategory] = useState("Pokémon GO"),
    [order, setOrder] = useState(""),
    [deliverySecret, setDeliverySecret] = useState(""),
    [notice, setNotice] = useState("");
  const inventory = useQuery({
    queryKey: ["inventory"],
    queryFn: () => api<{ items: InventoryItem[] }>("/api/inventory"),
    enabled: configured,
  });
  const mutation = useMutation({
    mutationFn: () =>
      reserve
        ? api("/api/inventory/reserve", {
            method: "POST",
            body: JSON.stringify({ item: reserve.id, order }),
          })
        : api("/api/inventory", {
            method: "POST",
            body: JSON.stringify({
              sku,
              title,
              category,
              ...(deliverySecret ? { secret: deliverySecret } : {}),
            }),
          }),
    onSuccess: () => {
      setOpen(false);
      setSku("");
      setTitle("");
      setDeliverySecret("");
      setNotice(
        reserve
          ? "Item reserved atomically for the order."
          : "Inventory item created.",
      );
      cache.invalidateQueries({ queryKey: ["inventory"] });
    },
    onError: (e) => setNotice(e.message),
  });
  return (
    <>
      <PageHeading
        eyebrow="DIGITAL STOCKROOM"
        title="Inventory, under control."
        description="Track individual items and reserve them without double allocation."
      >
        <Button
          disabled={!configured}
          onClick={() => {
            setReserve(null);
            setOpen(true);
          }}
        >
          <Plus size={14} />
          Add inventory item
        </Button>
      </PageHeading>
      <div className="info-banner">
        <Layers3 size={14} />
        <span>
          Internal inventory is separate from Eldorado listing quantities.
          Reservations are enforced atomically in PostgreSQL.
        </span>
      </div>
      {notice && (
        <p className="inline-feedback" role="status">
          {notice}
        </p>
      )}
      <section className="data-panel">
        {inventory.isError ? (
          <QueryError message={inventory.error.message} />
        ) : (
          <>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>Product</th>
                    <th>Category</th>
                    <th>Availability</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {inventory.data?.items.map((item) => (
                    <tr key={item.id}>
                      <td className="mono">{item.sku}</td>
                      <td>{item.title}</td>
                      <td>{item.category}</td>
                      <td>
                        <span
                          className={`state-badge ${item.status === "available" ? "success" : ""}`}
                        >
                          {item.status}
                        </span>
                      </td>
                      <td>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={item.status !== "available"}
                          onClick={() => {
                            setReserve(item);
                            setOrder("");
                            setOpen(true);
                          }}
                        >
                          Reserve
                        </Button>
                        <InventoryActions item={item} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!inventory.data?.items.length && (
              <EmptyState
                title="A place for every digital product."
                description="Add Pokémon GO, Roblox, or other digital inventory. Every reservation is recorded and linked to an order."
              />
            )}
          </>
        )}
      </section>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          setOpen(value);
          if (!value) setDeliverySecret("");
        }}
      >
        <DialogContent>
          <DialogTitle>
            {reserve ? "Reserve inventory" : "Add inventory item"}
          </DialogTitle>
          <DialogDescription>
            {reserve
              ? "This reserves one item for an accessible order. It does not mark the order delivered."
              : "Create internal stock metadata. Do not put account passwords in titles or SKUs."}
          </DialogDescription>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              mutation.mutate();
            }}
          >
            {reserve ? (
              <label className="field-label">
                Order UUID
                <input
                  required
                  value={order}
                  onChange={(e) => setOrder(e.target.value)}
                  placeholder="Linked order ID"
                />
              </label>
            ) : (
              <>
                <label className="field-label">
                  SKU
                  <input
                    required
                    maxLength={100}
                    value={sku}
                    onChange={(e) => setSku(e.target.value)}
                  />
                </label>
                <label className="field-label">
                  Product title
                  <input
                    required
                    maxLength={200}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                  />
                </label>
                <label className="field-label">
                  Category
                  <input
                    required
                    maxLength={100}
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                  />
                </label>
                <label className="field-label">
                  Optional sensitive delivery data
                  <input
                    type="password"
                    autoComplete="off"
                    maxLength={4000}
                    value={deliverySecret}
                    onChange={(event) => setDeliverySecret(event.target.value)}
                    placeholder="Requires the configured inventory encryption key"
                  />
                </label>
              </>
            )}
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending
                ? "Saving..."
                : reserve
                  ? "Confirm reservation"
                  : "Create item"}
            </Button>
            {mutation.isError && (
              <p role="alert" className="form-error">
                {mutation.error.message}
              </p>
            )}
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
export function ApprovalsModule({ configured }: { configured: boolean }) {
  const cache = useQueryClient(),
    [selected, setSelected] = useState<Approval | null>(null),
    [reason, setReason] = useState(""),
    [notice, setNotice] = useState("");
  const approvals = useQuery({
    queryKey: ["approvals"],
    queryFn: () => api<{ items: Approval[] }>("/api/approvals"),
    enabled: configured,
    refetchInterval: 30000,
  });
  const decide = useMutation({
    mutationFn: (approve: boolean) =>
      api<{ message: string }>(`/api/approvals/${selected?.id}`, {
        method: "PATCH",
        body: JSON.stringify({ approve, reason }),
      }),
    onSuccess: (data) => {
      setNotice(data.message);
      setSelected(null);
      cache.invalidateQueries({ queryKey: ["approvals"] });
    },
    onError: (e) => setNotice(e.message),
  });
  return (
    <>
      <PageHeading
        eyebrow="OPERATIONAL SAFETY"
        title="A deliberate second look."
        description="Review sensitive requests before they become operational actions."
      />
      <div className="info-banner">
        <ShieldCheck size={15} />
        <span>
          Approved access changes apply internally and revoke sessions. Eldorado
          writes remain blocked pending verified contracts and explicit
          authorization.
        </span>
      </div>
      {notice && (
        <p className="inline-feedback" role="status">
          {notice}
        </p>
      )}
      <section className="data-panel">
        {approvals.isError ? (
          <QueryError message={approvals.error.message} />
        ) : (
          <>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Requested action</th>
                    <th>Target</th>
                    <th>Reason</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {approvals.data?.items.map((item) => (
                    <tr key={item.id}>
                      <td className="table-primary">{item.action}</td>
                      <td className="mono">{item.target_id.slice(0, 12)}</td>
                      <td>{item.reason}</td>
                      <td>
                        <span className="state-badge">{item.status}</span>
                      </td>
                      <td>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={item.status !== "pending"}
                          onClick={() => {
                            setSelected(item);
                            setReason("");
                          }}
                        >
                          Review
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!approvals.data?.items.length && (
              <EmptyState
                title="No requests waiting for a second look."
                description="Authorized staff can request actions from an order. A different authorized reviewer must approve or reject each request."
              />
            )}
          </>
        )}
      </section>
      <Dialog
        open={Boolean(selected)}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <DialogContent>
          <DialogTitle>Review operational request</DialogTitle>
          <DialogDescription>
            Self-approval is prohibited. Approved access changes apply
            immediately; external actions remain disabled.
          </DialogDescription>
          <div className="review-summary">
            <span>Requested action</span>
            <strong>{selected?.action}</strong>
            <span>Target</span>
            <code>{selected?.target_id}</code>
            <span>Requester</span>
            <code>{selected?.requester_id}</code>
            {selected?.payload?.role && (
              <>
                <span>Requested role</span>
                <strong>{selected.payload.role}</strong>
                <span>Account status</span>
                <strong>
                  {selected.payload.active ? "Active" : "Inactive"}
                </strong>
                <span>Permission overrides</span>
                {selected.payload.overrides?.length ? (
                  selected.payload.overrides?.map((override) => (
                    <code key={override.permission}>
                      {override.allowed ? "ALLOW" : "DENY"} ·{" "}
                      {override.permission}
                    </code>
                  ))
                ) : (
                  <strong>Role defaults only</strong>
                )}
              </>
            )}
            {selected?.payload?.operation && (
              <>
                <span>Internal operation</span>
                <strong>{selected.payload.operation}</strong>
                <span>Reservation</span>
                <code>{selected.payload.reservation}</code>
              </>
            )}
          </div>
          <p className="review-reason">{selected?.reason}</p>
          <label className="field-label">
            Decision reason
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={2000}
            />
          </label>
          <div className="dialog-actions">
            <Button
              variant="outline"
              disabled={reason.trim().length < 3 || decide.isPending}
              onClick={() => decide.mutate(false)}
            >
              <X size={13} />
              Reject
            </Button>
            <Button
              disabled={reason.trim().length < 3 || decide.isPending}
              onClick={() => decide.mutate(true)}
            >
              <Check size={13} />
              Approve request
            </Button>
          </div>
          {decide.isError && (
            <p role="alert" className="form-error">
              {decide.error.message}
            </p>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
export function OffersModule({ configured }: { configured: boolean }) {
  const offers = useQuery({
    queryKey: ["offers"],
    queryFn: () =>
      api<{
        items: {
          id: string;
          title: string;
          category: string;
          state: string;
          price: number | null;
          currency: string | null;
          quantity: number | null;
        }[];
      }>("/api/workspace/offers"),
    enabled: configured,
  });
  return (
    <>
      <PageHeading
        eyebrow="LISTING OPERATIONS"
        title="Offers, without the clutter."
        description="A dedicated home for pricing, availability, and listing health."
      />
      <div className="info-banner">
        <Layers3 size={15} />
        <span>
          Live offer synchronization and mutations await verified official
          response schemas and request payloads. No listing changes are enabled.
        </span>
      </div>
      <section className="data-panel">
        {offers.isError ? (
          <QueryError message={offers.error.message} />
        ) : (
          <>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Offer</th>
                    <th>Category</th>
                    <th>Status</th>
                    <th>Price</th>
                    <th>Quantity</th>
                  </tr>
                </thead>
                <tbody>
                  {offers.data?.items.map((offer) => (
                    <tr key={offer.id}>
                      <td>{offer.title}</td>
                      <td>{offer.category}</td>
                      <td>{offer.state}</td>
                      <td>
                        {offer.price != null && offer.currency
                          ? money(offer.price, offer.currency)
                          : "—"}
                      </td>
                      <td>{offer.quantity ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!offers.data?.items.length && (
              <EmptyState
                title="Your listings deserve a clearer workspace."
                description="The offer module is isolated from the rest of your operation. Official contracts must be verified before connecting live listings."
                action={{
                  href: "/settings",
                  label: "Review integration status",
                }}
              />
            )}
          </>
        )}
      </section>
    </>
  );
}
export function ActivityModule({ configured }: { configured: boolean }) {
  const activity = useQuery({
    queryKey: ["activity"],
    queryFn: () =>
      api<{
        items: {
          id: string;
          action: string;
          actor_id: string;
          target_type: string;
          target_id: string | null;
          created_at: string;
        }[];
      }>("/api/workspace/activity"),
    enabled: configured,
  });
  return (
    <>
      <PageHeading
        eyebrow="TRACEABILITY"
        title="Every action leaves a record."
        description="An append-only operational trail, visible only to authorized staff."
      />
      <section className="data-panel">
        {activity.isError ? (
          <QueryError message={activity.error.message} />
        ) : (
          <>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Event</th>
                    <th>Actor</th>
                    <th>Target</th>
                    <th>Time</th>
                  </tr>
                </thead>
                <tbody>
                  {activity.data?.items.map((event) => (
                    <tr key={event.id}>
                      <td className="table-primary">{event.action}</td>
                      <td className="mono">
                        {event.actor_id?.slice(0, 12) ?? "System"}
                      </td>
                      <td>
                        {event.target_type} ·{" "}
                        {event.target_id?.slice(0, 12) ?? "—"}
                      </td>
                      <td>
                        {new Date(event.created_at).toLocaleString("en-US")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!activity.data?.items.length && (
              <EmptyState
                title="A trustworthy trail starts here."
                description="Invitations, permission changes, assignments, notes, approvals, inventory reservations, and synchronization produce audit events."
              />
            )}
          </>
        )}
      </section>
    </>
  );
}
