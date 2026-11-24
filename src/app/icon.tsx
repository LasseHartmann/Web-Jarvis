import { ImageResponse } from "next/og";

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background:
            "radial-gradient(circle at 50% 50%, #0b2438 0%, #02050b 75%)",
        }}
      >
        <div
          style={{
            width: 340,
            height: 340,
            borderRadius: "50%",
            border: "10px solid rgba(34,211,238,0.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 0 80px rgba(34,211,238,0.45)",
          }}
        >
          <div
            style={{
              width: 220,
              height: 220,
              borderRadius: "50%",
              border: "8px solid rgba(125,235,255,0.85)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <div
              style={{
                width: 96,
                height: 96,
                borderRadius: "50%",
                background:
                  "radial-gradient(circle, #ffffff 0%, #22d3ee 55%, rgba(34,211,238,0.15) 100%)",
              }}
            />
          </div>
        </div>
      </div>
    ),
    { ...size }
  );
}
