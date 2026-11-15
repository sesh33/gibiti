import type { Metadata } from "next";
import "./globals.css";
import "./visual-refresh.css";
import "./commerce-refresh.css";
import "./operations-refresh.css";
import "./settings-refresh.css";
import "./overview-auth-refresh.css";
import "./atmosphere.css";
import "./cinematic-interactions.css";
import "./route-motion.css";
import "./depth-surfaces.css";
import "./luminous-field.css";
import "./optical-surfaces.css";
import "./table-scroll.css";
import "./detail-refinements.css";
import "./visual-effects-preferences.css";
import { Providers } from "./providers";
import { workspaceBrand } from "@/lib/branding";
import { WorkspaceAtmosphere } from "@/components/workspace-atmosphere";
import { OpticalSurfaces } from "@/components/optical-surfaces";
import { PublicVisualEffectsControl } from "@/components/visual-effects-control";
export const metadata: Metadata = {
  title: {
    default: `${workspaceBrand.name} Control`,
    template: `%s · ${workspaceBrand.name} Control`,
  },
  icons: { icon: "/favicon.svg" },
  description: "Private seller operations and customer support workspace.",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body
        style={{ "--primary": workspaceBrand.accent } as React.CSSProperties}
      >
        <Providers>
          <WorkspaceAtmosphere />
          <OpticalSurfaces />
          <PublicVisualEffectsControl />
          {children}
        </Providers>
      </body>
    </html>
  );
}
