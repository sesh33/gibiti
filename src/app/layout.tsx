import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";
export const metadata: Metadata = {
  title: { default: "RIVOX Control", template: "%s · RIVOX Control" },
  icons: { icon: "/favicon.svg" },
  description: "Private seller operations and customer support workspace.",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
