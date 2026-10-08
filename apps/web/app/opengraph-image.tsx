import { ImageResponse } from "next/og";

// Social-share card for sievework.com — brand-token typography, no WebGL, so it
// renders deterministically server-side. Also used as the Twitter card.
export const alt = "Sieveworks — pay strangers to compute, and prove they did";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// The Sieveworks mark (meridian globe + verified core), rendered deterministically.
const MARK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="62" height="62"><g fill="none" stroke="#8EA0BC" stroke-width="2.2"><circle cx="24" cy="24" r="18"/><ellipse cx="24" cy="24" rx="7.6" ry="18"/><line x1="6" y1="24" x2="42" y2="24" stroke-linecap="round"/><path d="M9.6 14.6 Q24 20.4 38.4 14.6" stroke-linecap="round"/><path d="M9.6 33.4 Q24 27.6 38.4 33.4" stroke-linecap="round"/></g><g stroke="#8EA0BC" stroke-width="1.8" opacity="0.75" stroke-linecap="round"><line x1="24" y1="24" x2="35.6" y2="10.2"/><line x1="24" y1="24" x2="33" y2="39.6"/><line x1="24" y1="24" x2="6" y2="24"/></g><circle cx="35.6" cy="10.2" r="2.9" fill="#1E9E5C"/><circle cx="33" cy="39.6" r="2.6" fill="#FFFFFF" stroke="#8EA0BC" stroke-width="2"/><circle cx="6" cy="24" r="2.6" fill="#FFFFFF" stroke="#8EA0BC" stroke-width="2"/><circle cx="24" cy="24" r="6.8" fill="#2F79CE"/><path d="M20.4 24 l2.5 2.5 l4.85 -5.4" fill="none" stroke="#FFFFFF" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

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
          <img width={62} height={62} src={`data:image/svg+xml;base64,${Buffer.from(MARK_SVG).toString("base64")}`} style={{ display: "flex" }} />
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
