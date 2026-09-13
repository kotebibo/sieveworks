import { ImageResponse } from "next/og";

// Social-share card for sievework.com — brand-token typography, no WebGL, so it
// renders deterministically server-side. Also used as the Twitter card.
export const alt = "Sieveworks — pay strangers to compute, and prove they did";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#F5F7FA",
          padding: 76,
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div style={{ width: 46, height: 46, borderRadius: 12, background: "#2F79CE", display: "flex" }} />
          <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: 8, color: "#1E2430", display: "flex" }}>SIEVEWORKS</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 82, fontWeight: 800, lineHeight: 1.04, letterSpacing: -2, color: "#1E2430", display: "flex" }}>
            Pay strangers to compute.
          </div>
          <div style={{ fontSize: 82, fontWeight: 500, lineHeight: 1.04, letterSpacing: -2, color: "#2F79CE", display: "flex" }}>
            Prove they did.
          </div>
          <div style={{ fontSize: 30, color: "#5A6478", marginTop: 30, maxWidth: 920, display: "flex" }}>
            Verifiable distributed compute — re-checking the work costs under 1%, not 200%. Settled on Solana.
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 24, color: "#6E7889" }}>
          <div style={{ width: 11, height: 11, borderRadius: 999, background: "#1E9E5C", display: "flex" }} />
          <div style={{ display: "flex" }}>Live on Solana devnet · sievework.com</div>
        </div>
      </div>
    ),
    { ...size },
  );
}
