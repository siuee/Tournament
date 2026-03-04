import * as React from "react";
import { cn, toTitleCase } from "@/lib/utils";
import { Users } from "lucide-react";

export interface PlayerCareerCardProps extends React.HTMLAttributes<HTMLDivElement> {
  player: {
    id: string;
    name?: string;
    videoUrl?: string | null;
    goals1v1?: number;
    goals2v2?: number;
    assists2v2?: number;
    tGoals?: number;
    tAssists?: number;
  };
  themeColor?: string; // HSL value e.g. "150 50% 25%"
}

const PlayerCareerCard = React.forwardRef<HTMLDivElement, PlayerCareerCardProps>(
  ({ className, player, themeColor = "160 70% 35%", ...props }, ref) => {
    const totalGA = (player.tGoals || 0) + (player.tAssists || 0);
    const displayName = toTitleCase(player?.name || "").split(" ")[0] || "Player";
    const g1 = player.goals1v1 ?? 0;
    const g2 = player.goals2v2 ?? 0;
    const a2 = player.assists2v2 ?? 0;

    return (
      <div
        ref={ref}
        style={
          {
            "--theme-color": themeColor,
          } as React.CSSProperties
        }
        className={cn("group w-full h-full min-h-[420px]", className)}
        {...props}
      >
        <div
          className="relative block w-full h-full rounded-2xl overflow-hidden shadow-lg 
                     transition-all duration-500 ease-in-out 
                     group-hover:scale-[1.02] group-hover:shadow-[0_0_50px_-15px_hsl(var(--theme-color)/0.5)]"
          style={{
            boxShadow: `0 0 30px -10px hsl(var(--theme-color) / 0.4)`,
          }}
        >
          {/* Profile Video / Fallback Image */}
          <div
            className="absolute inset-0 bg-cover bg-center 
                       transition-transform duration-500 ease-in-out group-hover:scale-110"
          >
            {player.videoUrl ? (
              <video
                src={player.videoUrl}
                autoPlay
                loop
                muted
                playsInline
                preload="metadata"
                className="w-full h-full object-cover object-top"
              />
            ) : (
              <div
                className="w-full h-full bg-[#0a1120]"
                style={{
                  backgroundImage: `url(https://images.unsplash.com/photo-1574629810360-7efbbe195018?w=600&auto=format&fit=crop&q=60)`,
                  backgroundSize: "cover",
                  backgroundPosition: "center",
                }}
              />
            )}
          </div>

          {/* Gradient Overlay - colorful at bottom for stats */}
          <div
            className="absolute inset-0"
            style={{
              background: `linear-gradient(to top, 
                hsl(var(--theme-color) / 0.95) 0%, 
                hsl(var(--theme-color) / 0.75) 15%, 
                hsl(var(--theme-color) / 0.4) 40%, 
                transparent 65%)`,
            }}
          />

          {/* Content - sits at bottom with gradient behind */}
          <div className="relative flex flex-col justify-end h-full p-5 text-white min-h-0">
            <h3 className="font-sport text-2xl sm:text-3xl font-semibold tracking-wide">
              {displayName}
            </h3>
            <p className="text-sm text-white/90 mt-1 font-medium">
              Total G/A: <span className="font-black text-[#00ff88]">{totalGA}</span>
            </p>

            {/* Stats Row */}
            <div className="mt-6 grid grid-cols-3 gap-2 text-center">
              <div className="bg-black/30 backdrop-blur-sm rounded-lg px-2 py-2.5 border border-white/10">
                <span className="text-base leading-none block mb-0.5">⚽</span>
                <p className="text-lg font-black leading-none">{g1}</p>
                <p className="text-[10px] text-white/70 uppercase tracking-widest mt-0.5">1v1 Gls</p>
              </div>
              <div className="bg-black/30 backdrop-blur-sm rounded-lg px-2 py-2.5 border border-white/10">
                <span className="text-base leading-none block mb-0.5">⚽</span>
                <p className="text-lg font-black leading-none">{g2}</p>
                <p className="text-[10px] text-white/70 uppercase tracking-widest mt-0.5">2v2 Gls</p>
              </div>
              <div className="bg-black/30 backdrop-blur-sm rounded-lg px-2 py-2.5 border border-white/10">
                <span className="text-base leading-none block mb-0.5">👟</span>
                <p className="text-lg font-black leading-none">{a2}</p>
                <p className="text-[10px] text-white/70 uppercase tracking-widest mt-0.5">2v2 Ast</p>
              </div>
            </div>

            {/* Career G/A Footer */}
            <div
              className="mt-4 flex items-center justify-between bg-[hsl(var(--theme-color)/0.25)] backdrop-blur-md 
                         border border-[hsl(var(--theme-color)/0.4)] rounded-lg px-4 py-3 
                         transition-all duration-300 
                         group-hover:bg-[hsl(var(--theme-color)/0.35)] group-hover:border-[hsl(var(--theme-color)/0.5)]"
            >
              <span className="text-sm font-semibold tracking-wide flex items-center gap-1.5">
                <Users className="h-4 w-4" /> Career G/A
              </span>
              <span className="text-xl font-black text-[#00ff88]">{totalGA}</span>
            </div>
          </div>
        </div>
      </div>
    );
  }
);
PlayerCareerCard.displayName = "PlayerCareerCard";

export { PlayerCareerCard };
