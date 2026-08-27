import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Paperlike',
  description: 'A code-native design canvas with realtime multiplayer.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
