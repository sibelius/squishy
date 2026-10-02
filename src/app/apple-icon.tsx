import { ImageResponse } from "next/og";
import { SquishyMark } from "@/lib/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: "#ec4899" }}>
        <SquishyMark size={180} />
      </div>
    ),
    size,
  );
}
