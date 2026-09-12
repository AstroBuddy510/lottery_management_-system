import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { Ticket, AlertCircle, Clock } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { LiveSalesSection } from "@/components/live-sales";

export function WriterDashboard() {
  const { user } = useAuth();
  
  // Fetch live games
  const { data: games } = useQuery({
    queryKey: ["/api/games"],
    queryFn: async () => {
      const res = await fetch("/api/games", {
        headers: { Authorization: `Bearer ${localStorage.getItem("accessToken")}` }
      });
      return res.json();
    }
  });

  const liveGames = games?.filter((g: any) => g.status === "live") || [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Welcome, {user?.fullName}</h1>
          <p className="text-muted-foreground">ID: {user?.fullCode} • Model: <span className="capitalize font-medium text-primary">{user?.operationModel}</span></p>
        </div>
        <div className="flex gap-2">
          <Link href="/writer/place-bet">
             <Button className="w-full sm:w-auto"><Ticket className="mr-2 h-4 w-4" /> Place Bet</Button>
          </Link>
        </div>
      </div>

      <LiveSalesSection title="My Live Sales" />

      <h2 className="text-lg font-bold mt-8 mb-4">Live Games</h2>
      
      {liveGames.length === 0 ? (
        <Card className="bg-muted/50 border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
            <AlertCircle className="h-10 w-10 mb-4 opacity-50" />
            <p className="font-medium">No live games available</p>
            <p className="text-sm">Check back later when games are opened by the administrator.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {liveGames.map((game: any) => (
             <Card key={game.id} className="overflow-hidden">
               <div className="h-2 w-full bg-green-500" />
               <CardContent className="p-6">
                 <div className="flex justify-between items-start mb-4">
                   <div>
                     <h3 className="font-bold text-lg">{game.name}</h3>
                     <p className="text-sm text-muted-foreground">{game.eventNumber}</p>
                   </div>
                   <div className="flex items-center gap-1 text-sm font-medium text-orange-500 bg-orange-50 px-2 py-1 rounded-full">
                     <Clock className="h-3.5 w-3.5" /> Closes: {new Date(game.closeAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                   </div>
                 </div>
                 <Link href={`/writer/place-bet?game=${game.id}`}>
                   <Button className="w-full" variant="outline">Play Now</Button>
                 </Link>
               </CardContent>
             </Card>
          ))}
        </div>
      )}
    </div>
  );
}
