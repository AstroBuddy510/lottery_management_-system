import { useGetMyAgent, getGetMyAgentQueryKey } from "@workspace/api-client-react";
import { WriterManager } from "@/components/writer-manager";
import { Card, CardContent } from "@/components/ui/card";

export function MyWriters() {
  const { data: agent, isLoading, isError } = useGetMyAgent({
    query: { queryKey: getGetMyAgentQueryKey() }
  });

  if (isLoading) {
    return (
      <div className="p-6 flex items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (isError || !agent) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            No agent profile found for your account. Contact your administrator.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold">My Writers</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage the writers registered under your agent code{" "}
          <span className="font-mono font-semibold text-foreground">{agent.fullCode}</span>.
        </p>
      </div>

      <WriterManager agentId={agent.id} agentFullCode={agent.fullCode} />
    </div>
  );
}
