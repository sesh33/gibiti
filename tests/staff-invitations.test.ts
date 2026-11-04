import { describe, expect, it, vi } from "vitest";
import {
  provisionStaffInvitation,
  staffInvitationInput,
  type StaffInvitationDependencies,
} from "@/domains/authentication/staff-invitations";
import type { Permission } from "@/domains/authorization/permissions";
import { AppError } from "@/lib/errors";

const owner = {
  id: "11111111-1111-4111-8111-111111111111",
  role: "OWNER" as const,
  permissions: new Set<Permission>(["team.invite"]),
};
const employee = "22222222-2222-4222-8222-222222222222";
const otherUser = "33333333-3333-4333-8333-333333333333";
const hash = "synthetic-private-invitation-capability";
const input = staffInvitationInput.parse({
  email: " Employee@Example.Test ",
  name: "Synthetic Employee",
  delivery: "link",
});
function dependencies() {
  return {
    origin: "https://rivox.example",
    membershipExists: vi.fn().mockResolvedValue(false),
    createAccount: vi.fn().mockResolvedValue(employee),
    createMembership: vi.fn().mockResolvedValue(undefined),
    activateMembership: vi.fn().mockResolvedValue(undefined),
    sendEmail: vi.fn().mockResolvedValue({ userId: employee }),
    generateLink: vi.fn().mockResolvedValue({
      userId: employee,
      hashedToken: hash,
      verificationType: "invite",
    }),
    audit: vi.fn().mockResolvedValue(undefined),
    deactivateMembership: vi.fn().mockResolvedValue(undefined),
    deleteMembership: vi.fn().mockResolvedValue(undefined),
    deleteAccount: vi.fn().mockResolvedValue(undefined),
    recordFailure: vi.fn().mockResolvedValue(undefined),
  } satisfies StaffInvitationDependencies;
}

describe("Owner-confirmed staff invitation provisioning", () => {
  it("normalizes identity and defaults new staff to Support without changing existing callers' email delivery", () => {
    expect(input.email).toBe("employee@example.test");
    expect(input.role).toBe("SUPPORT_AGENT");
    expect(
      staffInvitationInput.parse({ email: input.email, name: input.name })
        .delivery,
    ).toBe("email");
    expect(() =>
      staffInvitationInput.parse({ ...input, role: "OWNER" }),
    ).toThrow();
  });

  it("requires both the Owner role and invitation permission before touching Auth or membership", async () => {
    for (const actor of [
      { ...owner, role: "ADMIN" as const },
      { ...owner, permissions: new Set<Permission>() },
    ]) {
      const deps = dependencies();
      await expect(
        provisionStaffInvitation(actor, input, deps),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(deps.membershipExists).not.toHaveBeenCalled();
      expect(deps.createAccount).not.toHaveBeenCalled();
    }
  });

  it("uses a single-use fragment handoff without sending email or auditing the credential", async () => {
    const deps = dependencies();
    const result = await provisionStaffInvitation(owner, input, deps);
    expect(result.delivery).toBe("link");
    if (result.delivery !== "link") throw new Error("Expected private handoff");
    const link = new URL(result.inviteUrl);
    expect(link.origin).toBe(deps.origin);
    expect(link.pathname).toBe("/account/setup");
    expect(link.search).toBe("");
    expect(new URLSearchParams(link.hash.slice(1)).get("token_hash")).toBe(
      hash,
    );
    expect(new URLSearchParams(link.hash.slice(1)).get("type")).toBe("invite");
    expect(deps.sendEmail).not.toHaveBeenCalled();
    expect(deps.generateLink).toHaveBeenCalledWith(
      input.email,
      "https://rivox.example/account/setup",
    );
    expect(deps.createMembership).toHaveBeenCalledWith({
      id: employee,
      email: input.email,
      name: input.name,
      role: "SUPPORT_AGENT",
    });
    expect(deps.audit.mock.calls.map(([event]) => event.action)).toEqual([
      "staff.invitation_prepared",
      "staff.invitation_link_created",
    ]);
    expect(JSON.stringify(deps.audit.mock.calls)).not.toContain(hash);
    expect(deps.audit.mock.invocationCallOrder[0]).toBeLessThan(
      deps.activateMembership.mock.invocationCallOrder[0],
    );
    expect(deps.activateMembership.mock.invocationCallOrder[0]).toBeLessThan(
      deps.generateLink.mock.invocationCallOrder[0],
    );
    expect(deps.deleteAccount).not.toHaveBeenCalled();
  });

  it("preserves explicit email invitations without returning any private capability", async () => {
    const deps = dependencies();
    const result = await provisionStaffInvitation(
      owner,
      { ...input, delivery: "email" },
      deps,
    );
    expect(result).toEqual({ delivery: "email" });
    expect(deps.sendEmail).toHaveBeenCalledWith(
      input.email,
      "https://rivox.example/account/setup",
    );
    expect(deps.generateLink).not.toHaveBeenCalled();
    expect(deps.audit.mock.calls[1][0].action).toBe("staff.invited");
  });

  it("does not create, replace, deactivate, or delete an existing membership", async () => {
    const deps = dependencies();
    deps.membershipExists.mockResolvedValue(true);
    await expect(
      provisionStaffInvitation(owner, input, deps),
    ).rejects.toMatchObject({ code: "MEMBERSHIP_EXISTS" });
    expect(deps.createAccount).not.toHaveBeenCalled();
    expect(deps.deactivateMembership).not.toHaveBeenCalled();
    expect(deps.deleteAccount).not.toHaveBeenCalled();
  });

  it("never deletes an account if atomic Auth creation reports that the address already exists", async () => {
    const deps = dependencies();
    deps.createAccount.mockRejectedValue(
      new AppError("ACCOUNT_EXISTS", "Existing account", 409),
    );
    await expect(
      provisionStaffInvitation(owner, input, deps),
    ).rejects.toMatchObject({ code: "ACCOUNT_EXISTS" });
    expect(deps.createMembership).not.toHaveBeenCalled();
    expect(deps.deleteMembership).not.toHaveBeenCalled();
    expect(deps.deleteAccount).not.toHaveBeenCalled();
  });

  it.each(["createMembership", "activateMembership", "generateLink"] as const)(
    "removes only this newly created account when %s fails",
    async (stage) => {
      const deps = dependencies();
      deps[stage].mockRejectedValue(new Error("private upstream fixture"));
      await expect(
        provisionStaffInvitation(owner, input, deps),
      ).rejects.toMatchObject({ code: "INVITATION_FAILED" });
      expect(deps.deactivateMembership).toHaveBeenCalledWith(employee);
      expect(deps.deleteMembership).toHaveBeenCalledExactlyOnceWith(employee);
      expect(deps.deleteAccount).toHaveBeenCalledExactlyOnceWith(employee);
      expect(deps.sendEmail).not.toHaveBeenCalled();
    },
  );

  it("fails closed before activation if the preparation audit is unavailable", async () => {
    const deps = dependencies();
    deps.audit.mockRejectedValue(
      new AppError("AUDIT_FAILED", "Unavailable audit", 500),
    );
    await expect(
      provisionStaffInvitation(owner, input, deps),
    ).rejects.toMatchObject({ code: "AUDIT_FAILED" });
    expect(deps.activateMembership).not.toHaveBeenCalled();
    expect(deps.generateLink).not.toHaveBeenCalled();
    expect(deps.deleteAccount).toHaveBeenCalledWith(employee);
  });

  it("returns no link and revokes the new account if issuance cannot be audited", async () => {
    const deps = dependencies();
    deps.audit
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(
        new AppError("AUDIT_FAILED", "Unavailable audit", 500),
      );
    await expect(
      provisionStaffInvitation(owner, input, deps),
    ).rejects.toMatchObject({ code: "AUDIT_FAILED" });
    expect(deps.generateLink).toHaveBeenCalledOnce();
    expect(deps.deactivateMembership).toHaveBeenCalledWith(employee);
    expect(deps.deleteAccount).toHaveBeenCalledWith(employee);
  });

  it("does not let an invitation response substitute or delete somebody else's Auth account", async () => {
    const deps = dependencies();
    deps.generateLink.mockResolvedValue({
      userId: otherUser,
      hashedToken: hash,
      verificationType: "invite",
    });
    await expect(
      provisionStaffInvitation(owner, input, deps),
    ).rejects.toMatchObject({ code: "INVITATION_PROOF_INVALID" });
    expect(deps.deleteAccount).toHaveBeenCalledExactlyOnceWith(employee);
    expect(deps.deleteAccount).not.toHaveBeenCalledWith(otherUser);
  });

  it.each([
    { hashedToken: "", verificationType: "invite" },
    { hashedToken: hash, verificationType: "recovery" },
  ])("does not disclose a malformed invitation capability", async (proof) => {
    const deps = dependencies();
    deps.generateLink.mockResolvedValue({ userId: employee, ...proof });
    await expect(
      provisionStaffInvitation(owner, input, deps),
    ).rejects.toMatchObject({ code: "INVITATION_PROOF_INVALID" });
    expect(deps.deleteAccount).toHaveBeenCalledWith(employee);
  });

  it("keeps SMTP failures explicit and removes the newly prepared employee", async () => {
    const deps = dependencies();
    deps.sendEmail.mockRejectedValue(
      new AppError("INVITATION_EMAIL_FAILED", "Choose a private link.", 502),
    );
    await expect(
      provisionStaffInvitation(owner, { ...input, delivery: "email" }, deps),
    ).rejects.toMatchObject({ code: "INVITATION_EMAIL_FAILED" });
    expect(deps.deleteAccount).toHaveBeenCalledWith(employee);
  });

  it("records an incomplete rollback without exposing credentials or pretending the invitation succeeded", async () => {
    const deps = dependencies();
    deps.audit.mockRejectedValue(new Error("audit unavailable"));
    deps.deleteAccount.mockRejectedValue(new Error("private cleanup detail"));
    await expect(
      provisionStaffInvitation(owner, input, deps),
    ).rejects.toMatchObject({ code: "INVITATION_RECONCILIATION_REQUIRED" });
    expect(deps.deactivateMembership).toHaveBeenCalledWith(employee);
    expect(deps.recordFailure).toHaveBeenCalledExactlyOnceWith(
      "INVITE_ROLLBACK_INCOMPLETE",
    );
    expect(JSON.stringify(deps.recordFailure.mock.calls)).not.toContain(hash);
  });

  it.each([
    "http://public.example",
    "https://rivox.example/other",
    "https://user:password@rivox.example",
    "https://rivox.example?redirect=external",
  ])("rejects an unsafe configured invitation origin", async (origin) => {
    const deps = dependencies();
    deps.origin = origin;
    await expect(
      provisionStaffInvitation(owner, input, deps),
    ).rejects.toMatchObject({ code: "SETUP_REQUIRED" });
    expect(deps.createAccount).not.toHaveBeenCalled();
  });
});
