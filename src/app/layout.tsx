import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";

// Tipografia da marca Amotex Prevent: Oswald (títulos, labels em caixa alta)
// + IBM Plex Sans (texto corrido) — ver src/app/globals.css para os tokens
// de cor que acompanham essa identidade.
// As fontes ficam no projeto (src/app/fonts, licença OFL, subset latin, pacotes
// @fontsource): o build não depende de baixar nada do Google.
const oswald = localFont({
  variable: "--font-oswald",
  display: "swap",
  src: [
    { path: "./fonts/oswald-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "./fonts/oswald-latin-600-normal.woff2", weight: "600", style: "normal" },
    { path: "./fonts/oswald-latin-700-normal.woff2", weight: "700", style: "normal" },
  ],
});

const ibmPlexSans = localFont({
  variable: "--font-ibm-plex-sans",
  display: "swap",
  src: [
    { path: "./fonts/ibm-plex-sans-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/ibm-plex-sans-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "./fonts/ibm-plex-sans-latin-600-normal.woff2", weight: "600", style: "normal" },
  ],
});

export const metadata: Metadata = {
  title: "Amotex Prevent — Sistema de OS",
  description: "Gestão de ordens de serviço, checklists e manutenção preventiva/corretiva de condomínios.",
  // O manifest vem de src/app/manifest.ts (Next liga sozinho).
  icons: {
    icon: "/icon-192.png",
    apple: "/apple-touch-icon.png",
  },
  appleWebApp: { capable: true, title: "Amotex", statusBarStyle: "black" },
};

export const viewport: Viewport = {
  themeColor: "#0B1E3A",
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
