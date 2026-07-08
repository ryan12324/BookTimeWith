import type { Metadata } from "next";
import { Source_Serif_4, Libre_Franklin } from "next/font/google";
import "./globals.css";

const serif = Source_Serif_4({
  subsets: ["latin"],
  weight: ["400", "600"],
  variable: "--font-serif",
  display: "swap",
});

const sans = Libre_Franklin({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://booktimewith.com"),
  title: {
    default: "Book Time With — the un-software for booking clients",
    template: "%s · Book Time With",
  },
  description:
    "One link. Your availability. Clients pick a time and you show up. We deleted everything else on purpose.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${serif.variable} ${sans.variable}`}>
      <body>{children}</body>
    </html>
  );
}
