import type { Metadata } from "next";
import { Oswald, IBM_Plex_Sans } from "next/font/google";
import "./globals.css";

// Tipografia da marca Amotex Prevent: Oswald (títulos, labels em caixa alta)
// + IBM Plex Sans (texto corrido) — ver src/app/globals.css para os tokens
// de cor que acompanham essa identidade.
const oswald = Oswald({
  variable: "--font-oswald",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

const ibmPlexSans = IBM_Plex_Sans({
  variable: "--font-ibm-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Amotex Prevent — Sistema de OS",
  description: "Gestão de ordens de serviço, checklists e manutenção preventiva/corretiva de condomínios.",
  manifest: "/manifest.json",
  icons: {
    icon: "/icon-192.png",
    apple: "/apple-touch-icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // suppressHydrationWarning: extensões do navegador (ex.: tradutor) alteram
  // atributos de <html>/<body> antes da hidratação. Sem isso, o Next mostra um
  // overlay de erro em dev que trava a tela.
  return (
    <html
      lang="pt-BR"
      suppressHydrationWarning
      className={`${oswald.variable} ${ibmPlexSans.variable} h-full antialiased`}
    >
      <body suppressHydrationWarning className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
