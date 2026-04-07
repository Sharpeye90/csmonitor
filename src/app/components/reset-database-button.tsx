"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function ResetDatabaseButton() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <div className="panel">
      <h2 className="section-title">Очистка базы</h2>
      <button
        type="button"
        className="danger-button"
        disabled={isPending}
        onClick={() => {
          const confirmed = window.confirm(
            "Удалить все матчи, сезоны и статистику игроков из базы данных?"
          );

          if (!confirmed) {
            return;
          }

          startTransition(async () => {
            setError(null);

            const response = await fetch("/api/admin/reset", {
              method: "POST"
            });

            const payload = (await response.json()) as { error?: string | null };

            if (!response.ok) {
              setError(payload.error || "Не удалось очистить базу");
              return;
            }

            router.refresh();
          });
        }}
      >
        {isPending ? "Очищаем..." : "Очистить БД полностью"}
      </button>
      {error ? <p className="error">{error}</p> : null}
    </div>
  );
}
