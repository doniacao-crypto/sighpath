import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "SightPath",
  description:
    "SightPath — webcam-based eye-movement assessment: calibrate the tracker against the patient, run a smooth-pursuit test and review the measurements. Measurements stay in the browser.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
