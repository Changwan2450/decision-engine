import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Decision-First Research Workspace",
  description: "Local-first research runs that end in decisions."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
