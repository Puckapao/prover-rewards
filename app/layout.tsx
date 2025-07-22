import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Prover Rewards Checker',
  description: 'Check prover rewards for Aztec rollup',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="bg-gray-50">{children}</body>
    </html>
  )
}