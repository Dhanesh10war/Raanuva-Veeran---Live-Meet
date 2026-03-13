import React, { useRef, useEffect, memo } from 'react';
import { MicOff, User, MoreVertical, Hand, ShieldCheck } from 'lucide-react';
import { Participant } from '../types';
import { cn } from '../lib/utils';

interface ParticipantTileProps {
  participant: Participant;
  isMain?: boolean;
}

const ParticipantTileComponent: React.FC<ParticipantTileProps> = ({ participant, isMain }) => {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current && participant.stream) {
      videoRef.current.srcObject = participant.stream;
      videoRef.current.onloadedmetadata = () => {
        videoRef.current?.play().catch(e => console.error("Error playing video:", e));
      };
    }
  }, [participant.stream, participant.isCameraOff]);

  return (
    <div className={cn(
      "relative bg-zinc-800 rounded-2xl overflow-hidden group transition-all duration-500 border-2",
      isMain ? "w-full h-full" : "aspect-video",
      participant.isHandRaised ? "border-emerald-500 shadow-[0_0_20px_rgba(16,185,129,0.2)]" : 
      participant.isSpeaking ? "border-indigo-500 shadow-[0_0_20px_rgba(99,102,241,0.3)]" : "border-transparent"
    )}>
      {participant.isCameraOff ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-900">
          <div className="w-24 h-24 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center shadow-inner mb-4">
            <span className="text-4xl font-black text-emerald-500">
              {participant.name.charAt(0).toUpperCase()}
            </span>
          </div>
          <span className="text-zinc-400 font-bold text-lg tracking-tight">
            {participant.name}
          </span>
        </div>
      ) : (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={participant.isLocal}
          className={cn("w-full h-full object-cover", participant.isLocal && "scale-x-[-1]")}
        />
      )}

      {/* Hand Raise Indicator */}
      {participant.isHandRaised && (
        <div className="absolute top-4 left-4 z-10">
          <div className="bg-emerald-500 text-zinc-950 p-2 rounded-xl shadow-lg animate-bounce">
            <Hand className="w-5 h-5 fill-current" />
          </div>
        </div>
      )}

      {/* Overlay Info */}
      <div className="absolute bottom-4 left-4 flex items-center gap-2">
        <div className="bg-zinc-950/60 backdrop-blur-xl px-3 py-1.5 rounded-xl flex items-center gap-2 border border-white/5">
          <span className="text-white text-xs font-bold tracking-tight">
            {participant.name} {participant.isLocal && "(You)"}
          </span>
          {participant.isHost && (
            <div className="flex items-center gap-1.5 px-1.5 py-0.5 rounded bg-orange-500/20 border border-orange-500/30">
              <ShieldCheck className="w-2.5 h-2.5 text-orange-500" />
              <span className="text-[8px] font-black text-orange-500 uppercase tracking-tighter">Host</span>
            </div>
          )}
          {participant.isMuted && (
            <div className="w-5 h-5 rounded-full bg-red-500/20 flex items-center justify-center">
              <MicOff className="w-3 h-3 text-red-500" />
            </div>
          )}
        </div>
      </div>

      {/* Status Indicators */}
      <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
        <div className="bg-black/40 backdrop-blur-md p-1.5 rounded-full">
          <MoreVertical className="w-4 h-4 text-white cursor-pointer" />
        </div>
      </div>
    </div>
  );
};

export const ParticipantTile = memo(ParticipantTileComponent);
