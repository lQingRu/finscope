import { singaporeCalendarDate } from "@finscope/contracts/financial-accounts";
import type { CSSProperties } from "react";
import { useEffect, useId, useRef, useState } from "react";
import { DayPicker } from "react-day-picker";
import "react-day-picker/style.css";
import { Button } from "./components/ui/button";

function calendarDay(value: string) {
  return new Date(`${value}T12:00:00Z`);
}

export function OpeningDateCalendar({ value, onSelect, earliestActivityDate }: {
  value: string;
  onSelect: (date: string) => void;
  earliestActivityDate?: string | null;
}) {
  const [today, setToday] = useState(singaporeCalendarDate);
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    function refresh() {
      setToday(singaporeCalendarDate());
    }

    let timer: ReturnType<typeof setTimeout>;
    function schedule() {
      refresh();
      const now = Date.now();
      const midnight = Date.parse(`${singaporeCalendarDate(new Date(now))}T00:00:00+08:00`);
      timer = setTimeout(schedule, midnight + 86_400_000 - now);
    }

    schedule();
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);

  const lastDate = earliestActivityDate && earliestActivityDate < today ? earliestActivityDate : today;
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value) ? calendarDay(value) : undefined;
  const selected = parsed && Number.isFinite(parsed.getTime())
    && parsed.toISOString().slice(0, 10) === value && value >= "0001-01-01" && value <= lastDate
    ? parsed : undefined;
  const lastDay = calendarDay(lastDate);

  return (
    <>
      <Button type="button" variant="outline" onClick={() => {
        setToday(singaporeCalendarDate());
        dialog.current?.showModal();
      }}>Choose date</Button>
      <dialog ref={dialog} aria-labelledby={titleId}
        className="m-auto max-h-[90dvh] max-w-[calc(100%-1rem)] overflow-auto rounded-xl p-4 shadow-lg backdrop:bg-black/40">
        <h3 id={titleId} className="mb-3 font-semibold">Choose opening date</h3>
        <DayPicker
          style={{ "--rdp-day-width": "38px", "--rdp-day_button-width": "36px" } as CSSProperties}
          key={selected?.toISOString() ?? "no-date"}
          mode="single"
          timeZone="UTC"
          today={calendarDay(today)}
          defaultMonth={selected ?? lastDay}
          startMonth={calendarDay("0001-01-01")}
          endMonth={lastDay}
          disabled={{ after: lastDay }}
          selected={selected}
          onSelect={(day) => {
            if (!day) return;
            const date = day.toISOString().slice(0, 10);
            if (date > singaporeCalendarDate() || (earliestActivityDate && date > earliestActivityDate)) return;
            onSelect(date);
            dialog.current?.close();
          }}
        />
        <Button type="button" variant="outline" onClick={() => dialog.current?.close()}>Cancel</Button>
      </dialog>
    </>
  );
}
