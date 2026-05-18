import { useQueries } from "@tanstack/react-query";
import { useListAgents, listWriters, getListWritersQueryKey, AgentWithUser, Writer } from "@workspace/api-client-react";

export function useWriterLookup() {
  const { data: agents } = useListAgents({});
  const agentList: AgentWithUser[] = Array.isArray(agents) ? agents : [];

  const results = useQueries({
    queries: agentList.map(a => ({
      queryKey: getListWritersQueryKey(a.id, {}),
      queryFn: () => listWriters(a.id, {}),
      staleTime: 60_000,
    })),
  });

  const writerMap: Record<string, { fullCode: string; fullName: string }> = {};
  const allWriters: (Writer & { agentId: string })[] = [];

  results.forEach((r, i) => {
    const writers = Array.isArray(r.data) ? r.data : [];
    const agentId = agentList[i]?.id ?? "";
    writers.forEach((w: Writer) => {
      writerMap[w.id] = { fullCode: w.fullCode, fullName: w.fullName };
      allWriters.push({ ...w, agentId });
    });
  });

  return { writerMap, agentList, allWriters };
}
