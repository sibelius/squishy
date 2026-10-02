import { ogAlt, renderOg } from "@/lib/og";

export const alt = ogAlt("/");
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return renderOg("/");
}
