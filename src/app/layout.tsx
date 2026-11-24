import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Asiyst Plan — Central Subscription & Billing Platform",
    template: "%s · Asiyst Plan",
  },
  description:
    "Explore Asiyst plans, unlock the capabilities you need, and manage your organization subscriptions, entitlements, and billing from one account.",
  metadataBase: new URL("https://plan.asiyst.com"),
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-[#F9F9F9] text-[#3F434C] antialiased flex flex-col">
        {children}
      </body>
    </html>
  );
}
