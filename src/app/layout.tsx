import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Ufer · Your finances, in perspective",
    template: "%s · Ufer"
  },
  description: "Your personal dashboard for accounts, transactions, and net worth."
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#233e31"
};

export default function RootLayout({ children }: Readonly<{
  children: React.ReactNode;
}>) {
  return <html lang="en"><body>{children}</body></html>;
}
