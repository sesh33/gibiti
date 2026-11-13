import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";
import { workspaceBrand } from "@/lib/branding";
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
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
