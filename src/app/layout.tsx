import "./globals.css";

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "CS2 Match Parser",
  description: "Загрузка скриншота CS2, распознавание матча и сохранение статистики в базу."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
