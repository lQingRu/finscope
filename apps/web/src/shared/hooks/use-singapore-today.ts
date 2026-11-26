import { singaporeCalendarDate } from "@finscope/contracts/financial-accounts";
import { useCallback, useEffect, useState } from "react";

export function useSingaporeToday() {
  const [today, setToday] = useState(singaporeCalendarDate);

  const refreshToday = useCallback(() => {
    setToday(singaporeCalendarDate());
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;

    function refresh() {
      const now = Date.now();
      const date = singaporeCalendarDate(new Date(now));
      setToday(date);
      const midnight = Date.parse(`${date}T00:00:00+08:00`);
      clearTimeout(timer);
      timer = setTimeout(refresh, midnight + 86_400_000 - now);
    }

    refresh();
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);

  return { today, refreshToday };
}
