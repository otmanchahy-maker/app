import { useQuery } from "@tanstack/react-query";

import { subscriptionStatus } from "@/src/api/client";

export function useAccess() {
  const q = useQuery({ queryKey: ["subscription"], queryFn: subscriptionStatus });
  return {
    locked: q.data?.paywall === true,
    level: q.data?.level as string | undefined,
    daysLeft: q.data?.days_left as number | null | undefined,
    isLoading: q.isLoading,
  };
}
