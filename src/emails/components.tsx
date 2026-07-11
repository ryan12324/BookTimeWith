import {
  Body,
  Container,
  Head,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from "react-email";
import type { CSSProperties } from "react";

/**
 * Shared chrome for all transactional emails: warm paper body, serif headline,
 * white detail cards, and a footer strip — the one layout the whole set shares.
 * Fonts fall back to system serif/sans (webfonts are unreliable in mail clients);
 * the shape and color carry the brand.
 */

const SERIF = "'Source Serif 4', Georgia, 'Times New Roman', serif";
const SANS = "'Libre Franklin', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif";

const main: CSSProperties = { backgroundColor: "#e9e5dc", margin: 0, padding: "24px 0", fontFamily: SANS };
const container: CSSProperties = {
  width: "100%",
  maxWidth: 600,
  margin: "0 auto",
  backgroundColor: "#faf8f4",
  border: "1px solid #8f8677",
  borderRadius: 10,
  overflow: "hidden",
};
const bodyPad: CSSProperties = { padding: "36px 40px 32px" };
const footerStrip: CSSProperties = {
  padding: "14px 40px",
  borderTop: "1px solid #efe9de",
  fontSize: 11,
  color: "#71695d",
  fontFamily: SANS,
};

export function EmailLayout({
  preview,
  footer,
  children,
}: {
  preview: string;
  footer: string;
  children: React.ReactNode;
}) {
  return (
    <Html>
      <Head />
      <Preview>{preview}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={bodyPad}>{children}</Section>
          <Section style={footerStrip}>{footer}</Section>
        </Container>
      </Body>
    </Html>
  );
}

export function Headline({ children }: { children: React.ReactNode }) {
  return (
    <Text
      style={{
        margin: 0,
        fontFamily: SERIF,
        fontSize: 26,
        fontWeight: 400,
        letterSpacing: "-0.01em",
        color: "#26221c",
        lineHeight: 1.2,
      }}
    >
      {children}
    </Text>
  );
}

export function Lead({ children }: { children: React.ReactNode }) {
  return (
    <Text
      style={{
        margin: "14px 0 0",
        fontFamily: SANS,
        fontSize: 14,
        lineHeight: 1.7,
        color: "#6b6357",
      }}
    >
      {children}
    </Text>
  );
}

export function FinePrint({ children }: { children: React.ReactNode }) {
  return (
    <Text style={{ margin: "16px 0 0", fontFamily: SANS, fontSize: 12, lineHeight: 1.6, color: "#71695d" }}>
      {children}
    </Text>
  );
}

/** White detail card that holds the booking / receipt facts. */
export function DetailCard({ children }: { children: React.ReactNode }) {
  return (
    <Section
      style={{
        marginTop: 20,
        backgroundColor: "#ffffff",
        border: "1px solid #e6dfd3",
        borderRadius: 8,
        padding: "20px 24px",
      }}
    >
      {children}
    </Section>
  );
}

export function CardTitle({ children }: { children: React.ReactNode }) {
  return (
    <Text style={{ margin: 0, fontFamily: SERIF, fontSize: 16, fontWeight: 600, color: "#26221c" }}>
      {children}
    </Text>
  );
}

export function CardLine({
  children,
  strong,
}: {
  children: React.ReactNode;
  strong?: boolean;
}) {
  return (
    <Text
      style={{
        margin: "6px 0 0",
        fontFamily: SANS,
        fontSize: 14,
        lineHeight: 1.7,
        color: strong ? "#26221c" : "#6b6357",
        fontWeight: strong ? 600 : 400,
      }}
    >
      {children}
    </Text>
  );
}

type BtnKind = "ink" | "outline" | "bronze-block";

export function Btn({
  children,
  kind = "ink",
  href,
}: {
  children: React.ReactNode;
  kind?: BtnKind;
  /** Every shipped CTA must have a real destination, including previews. */
  href: string;
}) {
  const base: CSSProperties = {
    display: "inline-block",
    fontFamily: SANS,
    fontSize: 13,
    fontWeight: 600,
    lineHeight: "20px",
    borderRadius: 6,
    padding: "12px 18px",
    textDecoration: "none",
  };
  const styles: Record<BtnKind, CSSProperties> = {
    ink: { ...base, background: "#26221c", color: "#faf8f4" },
    outline: { ...base, border: "1px solid #8f8677", color: "#26221c" },
    "bronze-block": {
      ...base,
      display: "block",
      textAlign: "center",
      background: "#776a50",
      color: "#faf8f4",
      fontSize: 13.5,
      padding: "12px 0",
    },
  };
  // Rendered as a styled anchor so it survives every mail client.
  return (
    <a href={href} style={styles[kind]}>
      {children}
    </a>
  );
}

export function ButtonRow({ children }: { children: React.ReactNode }) {
  return <Section style={{ marginTop: 18 }}>{children}</Section>;
}

export function Divider() {
  return <Hr style={{ borderColor: "#efe9de", margin: "0" }} />;
}

export { SERIF, SANS };
