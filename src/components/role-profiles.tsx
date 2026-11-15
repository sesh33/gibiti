"use client";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, ShieldCheck, Users } from "lucide-react";
import { api } from "@/lib/api-client";
import {
  roles,
  permissions,
  type Permission,
  type Role,
} from "@/domains/authorization/permissions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
export type RoleProfile = {
  id: string;
  name: string;
  base_role: Role;
  overrides: { permission: string; allowed: boolean }[];
};
export const catalogOperatorPreset = {
  name: "Catalog operator",
  baseRole: "SUPPORT_AGENT",
  overrides: [
    { permission: "offers.read", allowed: true },
    { permission: "offers.pause", allowed: true },
    { permission: "conversations.read", allowed: false },
    { permission: "conversations.reply", allowed: false },
    { permission: "conversations.internal_notes", allowed: false },
  ],
} as const satisfies {
  name: string;
  baseRole: Role;
  overrides: readonly { permission: Permission; allowed: boolean }[];
};
export function RoleProfiles({ configured }: { configured: boolean }) {
  const cache = useQueryClient(),
    [open, setOpen] = useState(false),
    [name, setName] = useState(""),
    [base, setBase] = useState<Role>("SUPPORT_AGENT"),
    [changes, setChanges] = useState<Record<string, string>>({});
  const query = useQuery({
    queryKey: ["role-profiles"],
    queryFn: () => api<{ items: RoleProfile[] }>("/api/team/roles"),
    enabled: configured,
    retry: false,
  });
  const me = useQuery({
    queryKey: ["me"],
    queryFn: () =>
      api<{ profile: { role: Role }; permissions: string[] }>("/api/me"),
    enabled: configured,
  });
  const save = useMutation({
    mutationFn: () =>
      api("/api/team/roles", {
        method: "POST",
        body: JSON.stringify({
          name,
          baseRole: base,
          overrides: Object.entries(changes)
            .filter(([, value]) => value !== "default")
            .map(([permission, value]) => ({
              permission,
              allowed: value === "allow",
            })),
        }),
      }),
    onSuccess: () => {
      setOpen(false);
      setName("");
      setChanges({});
      cache.invalidateQueries({ queryKey: ["role-profiles"] });
    },
  });
  return (
    <section className="data-panel settings-section role-profiles-panel">
      <div className="panel-title">
        <h2>
          <ShieldCheck size={15} />
          Custom roles
        </h2>
        <Button
          size="sm"
          variant="outline"
          disabled={!configured || me.data?.profile.role !== "OWNER"}
          onClick={() => {
            save.reset();
            setOpen(true);
          }}
        >
          <Plus size={12} />
          Create role
        </Button>
      </div>
      <p className="scope-note">
        Create reusable permission profiles, then select one when managing an
        employee. Assignments still require a separate reviewer. Existing
        employees never change automatically.
      </p>
      <div className="role-profile-collection">
        {query.data?.items.map((profile) => (
          <article className="role-profile-card" key={profile.id}>
            <span className="role-profile-icon">
              <Users size={17} />
            </span>
            <div>
              <strong>{profile.name}</strong>
              <small>{profile.base_role.replaceAll("_", " ")}</small>
            </div>
            <span className="role-profile-overrides">
              {profile.overrides.length}{" "}
              {profile.overrides.length === 1 ? "override" : "overrides"}
            </span>
          </article>
        ))}
      </div>
      {query.isError && <p className="form-error">{query.error.message}</p>}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogTitle>Create a custom role</DialogTitle>
          <DialogDescription>
            The base security role keeps its MFA requirements. Overrides are
            applied only after an employee access request is separately
            approved.
          </DialogDescription>
          <form
            className="role-profile-form"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate();
            }}
          >
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={save.isPending}
              onClick={() => {
                setName(catalogOperatorPreset.name);
                setBase(catalogOperatorPreset.baseRole);
                setChanges(
                  Object.fromEntries(
                    catalogOperatorPreset.overrides.map((override) => [
                      override.permission,
                      override.allowed ? "allow" : "deny",
                    ]),
                  ),
                );
              }}
            >
              <ShieldCheck size={13} />
              Use Catalog operator preset
            </Button>
            <p className="scope-note">
              This preset allows listing reads and pause or resume, retains
              assigned-order access, and disables messaging. Save the profile
              first. Employee assignment requires independent review.
            </p>
            <label className="field-label">
              Role name
              <input
                required
                minLength={2}
                maxLength={60}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label className="field-label">
              Base security role
              <select
                value={base}
                onChange={(e) => setBase(e.target.value as Role)}
              >
                {roles
                  .filter((role) => role !== "OWNER")
                  .map((role) => (
                    <option key={role} value={role}>
                      {role.replaceAll("_", " ")}
                    </option>
                  ))}
              </select>
            </label>
            <details className="permission-editor">
              <summary>Customize granular permissions</summary>
              {permissions.map((permission) => (
                <label key={permission}>
                  {permission}
                  <select
                    value={changes[permission] ?? "default"}
                    onChange={(e) =>
                      setChanges({ ...changes, [permission]: e.target.value })
                    }
                  >
                    <option value="default">Role default</option>
                    <option value="allow">Allow</option>
                    <option value="deny">Deny</option>
                  </select>
                </label>
              ))}
            </details>
            <Button disabled={save.isPending} type="submit">
              Save custom role
            </Button>
            {save.isError && (
              <p className="form-error" role="alert">
                {save.error.message}
              </p>
            )}
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
