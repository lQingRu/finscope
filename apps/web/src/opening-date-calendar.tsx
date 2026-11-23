import { singaporeCalendarDate } from "@finscope/contracts/financial-accounts";
import { useId, useRef } from "react";
import { DayPicker } from "react-day-picker";
import "react-day-picker/style.css";
import { Button } from "./components/ui/button";
import { useSingaporeToday } from "./use-singapore-today";

const calendarLabel = new Intl.DateTimeFormat("en-SG", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

function calendarDay(value: string) {
  return new Date(`${value}T12:00:00Z`);
}

export function OpeningDateCalendar({ value, onSelect, earliestActivityDate }: {
  value: string;
  onSelect: (date: string) => void;
  earliestActivityDate?: string | null;
}) {
  const { today, refreshToday } = useSingaporeToday();
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);

  const lastDate = earliestActivityDate && earliestActivityDate < today ? earliestActivityDate : today;
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value) ? calendarDay(value) : undefined;
  const selected = parsed && Number.isFinite(parsed.getTime())
    && parsed.toISOString().slice(0, 10) === value && value >= "0001-01-01" && value <= lastDate
    ? parsed : undefined;
  const lastDay = calendarDay(lastDate);

  return (
    <>
      <Button type="button" variant="outline" onClick={() => {
        refreshToday();
        dialog.current?.showModal();
      }}>Choose date</Button>
      <dialog ref={dialog} aria-labelledby={titleId}
        className="ui-dialog calendar-dialog">
        <h3 id={titleId} className="mb-3 font-semibold">Choose opening date</h3>
        <DayPicker
          className="opening-date-calendar"
          labels={{
            labelDayButton: (date, { today, selected }) =>
              `${today ? "Today, " : ""}${calendarLabel.format(date)}${selected ? ", selected" : ""}`,
          }}
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
