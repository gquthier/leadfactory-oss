export const dynamic='force-dynamic';
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lead Factory — Onboarding",
  description: "Démarrez votre campagne publicitaire Meta avec Lead Factory.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fr">
      <body className="bg-canvas text-lf-black antialiased">
        {children}
      </body>
    </html>
  );
}
