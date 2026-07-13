import { ImageResponse } from "next/og";

export const alt = "OnePercent — rental properties that cash flow";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const INK = "#faf7f2";
const TEXT = "#1b1712";
const HAZE = "#6b6258";
const PASS = "#0e7a52";
const BRASS = "#9c7a34";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          background: INK,
          fontFamily: "Georgia, serif",
        }}
      >
        <div
          style={{
            width: 420,
            height: "100%",
            background: PASS,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <span style={{ color: INK, fontSize: 260, fontWeight: 800 }}>1%</span>
        </div>
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            padding: "0 72px",
          }}
        >
          <span style={{ color: BRASS, fontSize: 34, fontWeight: 700, letterSpacing: 4 }}>
            ONEPERCENT
          </span>
          <span
            style={{
              color: TEXT,
              fontSize: 68,
              fontWeight: 800,
              lineHeight: 1.05,
              marginTop: 20,
            }}
          >
            Find rental properties
          </span>
          <span
            style={{
              color: TEXT,
              fontSize: 68,
              fontWeight: 800,
              lineHeight: 1.05,
            }}
          >
            that cash flow.
          </span>
          <span style={{ color: HAZE, fontSize: 34, marginTop: 28 }}>
            1%-rule deals · market analytics · deal scoring
          </span>
        </div>
      </div>
    ),
    { ...size },
  );
}
