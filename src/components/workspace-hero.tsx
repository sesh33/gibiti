"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowUpRight,
  Crosshair,
  Layers3,
  ShieldCheck,
  ShoppingBag,
  Zap,
} from "lucide-react";
import { api } from "@/lib/api-client";
import { workspaceBrand } from "@/lib/branding";
export function WorkspaceHero({ configured }: { configured: boolean }) {
  const me = useQuery({
    queryKey: ["me"],
    queryFn: () =>
      api<{ profile: { role: string }; permissions: string[] }>("/api/me"),
    enabled: configured,
  });
  const state = useQuery({
    queryKey: ["automation-settings"],
    queryFn: () =>
      api<{
        connection: { verifiedOnThisServer: boolean };
        settings: { autoPricingEnabled: boolean };
      }>("/api/automation/settings"),
    enabled: configured,
    retry: false,
  });
  const can = (permission: string) =>
    !configured ||
    !!me.data?.permissions.includes(permission) ||
    (permission === "orders.read" &&
      !!me.data?.permissions.includes("orders.read_assigned"));
  const actions = [
    {
      label: "Pricing engine",
      detail: "Protect your margin",
      href: "/automation",
      icon: Crosshair,
      permission: "offers.update_price",
    },
    {
      label: "Your catalog",
      detail: "Every listing, in focus",
      href: "/offers",
      icon: Layers3,
      permission: "offers.read",
    },
    {
      label: "Order center",
      detail: "Keep fulfillment moving",
      href: "/orders",
      icon: ShoppingBag,
      permission: "orders.read",
    },
  ].filter((item) => can(item.permission));
  return (
    <section className="workspace-hero rivox-hero">
      <div className="workspace-hero-copy">
        <div className="hero-overline">
          <span className="hero-dot" aria-hidden="true" />
          {workspaceBrand.name} · SELLER OPERATING SYSTEM
        </div>
        <h2>
          Built for your
          <br />
          <span>next move.</span>
        </h2>
        <p>
          Your catalog, pricing and team. One focused workspace, with you in
          control.
        </p>
        <div className="hero-trust">
          <ShieldCheck size={15} />
          <span>
            {state.data?.connection?.verifiedOnThisServer
              ? "Seller connection verified"
              : state.isError
                ? "Seller connection status could not be checked"
                : configured
                  ? "Your workspace is secured · Seller connection pending"
                  : "Individual access · Verified actions · Protected floors"}
          </span>
        </div>
      </div>
      <div className="hero-orbit optical-orbit" aria-hidden="true">
        <div className="optical-sculpture">
          <span className="optical-glass-plane optical-plane-back" />
          <span className="optical-glass-plane optical-plane-middle" />
          <span className="optical-glass-plane optical-plane-front" />
          <span className="optical-reticle" />
          <span className="optical-sculpture-axis" />
        </div>
        <span className="hero-coordinate hero-coordinate-top">
          FOCUS / CONTROL / MOMENTUM
        </span>
        <div className="orbit-ring orbit-ring-one" />
        <div className="orbit-ring orbit-ring-two" />
        <div className="orbit-ring orbit-ring-three" />
        <span className="orbit-point orbit-point-one" />
        <span className="orbit-point orbit-point-two" />
        <div className="orbit-core">
          <Zap size={42} fill="currentColor" />
        </div>
        <div className="orbit-tag orbit-tag-top">
          <Crosshair size={14} />
          <span>PRECISION FIRST</span>
        </div>
        <div className="orbit-tag orbit-tag-bottom">
          <ShieldCheck size={14} />
          <span>YOUR FLOOR. YOUR RULES.</span>
        </div>
        <span className="hero-coordinate hero-coordinate-bottom">
          ONE WORKSPACE. YOUR OPERATION.
        </span>
      </div>
      <div className="hero-shortcuts">
        {actions.map((action) => (
          <Link href={action.href} key={action.href}>
            <span className="hero-shortcut-icon">
              <action.icon size={19} />
            </span>
            <span>
              <strong>{action.label}</strong>
              <small>{action.detail}</small>
            </span>
            <ArrowUpRight size={16} />
          </Link>
        ))}
      </div>
    </section>
  );
}
