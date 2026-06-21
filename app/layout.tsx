import type { Metadata } from "next"
import "./globals.css"

export const metadata: Metadata = {
  title: "Aqua Municipal Dashboard",
  description: "Water token operations dashboard for voucher, redemption, kiosk, and distribution balance monitoring",
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
