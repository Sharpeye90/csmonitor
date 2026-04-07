"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function SeasonForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <div className="panel">
      <h2 className="section-title">Новый сезон</h2>
      <form
        className="upload-form"
        action={(formData) =>
          startTransition(async () => {
            setError(null);
            setSuccess(null);

            const payload = {
              name: String(formData.get("name") ?? ""),
              startDate: String(formData.get("startDate") ?? ""),
              endDate: String(formData.get("endDate") ?? "")
            };

            const response = await fetch("/api/seasons", {
              method: "POST",
              headers: {
                "Content-Type": "application/json"
              },
              body: JSON.stringify(payload)
            });

            const result = (await response.json()) as { error?: string | null; season?: { name: string } };

            if (!response.ok) {
              setError(result.error || "Не удалось создать сезон");
              return;
            }

            setSuccess(`Сезон "${result.season?.name ?? payload.name}" создан`);
            router.refresh();
          })
        }
      >
        <label>
          Название сезона
          <input name="name" type="text" placeholder="Например, Весна 2026" required />
        </label>
        <label>
          Дата начала
          <input name="startDate" type="date" required />
        </label>
        <label>
          Дата окончания
          <input name="endDate" type="date" required />
        </label>
        <button type="submit" disabled={isPending}>
          {isPending ? "Сохраняем..." : "Создать сезон"}
        </button>
      </form>

      {error ? <p className="error">{error}</p> : null}
      {success ? <p className="muted">{success}</p> : null}
    </div>
  );
}
