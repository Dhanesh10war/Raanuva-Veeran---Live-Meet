import React, { useState, useMemo } from 'react';
import { ControlBar } from './ControlBar';
import { ParticipantTile } from './ParticipantTile';
import { Sidebar } from './Sidebar';
import { useWebRTC } from '../hooks/useWebRTC';
import { cn } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { Share2, Users, MessageSquare, Hand, ShieldCheck } from 'lucide-react';

interface MeetingRoomProps {
  roomCode: string;
  userName: string;
  isAdmin: boolean;
  onLeave: () => void;
}

export const MeetingRoom: React.FC<MeetingRoomProps> = ({ roomCode, userName, isAdmin, onLeave }) => {
  const [sidebarType, setSidebarType] = useState<'chat' | 'participants' | 'polls' | 'qa' | null>(null);
  const [copied, setCopied] = useState(false);
  
  const {
    participants,
    messages,
    polls,
    questions,
    isMuted,
    isCameraOff,
    isScreenSharing,
    isHandRaised,
    isHost,
    toggleMic,
    toggleCamera,
    toggleScreenShare,
    toggleHandRaise,
    muteParticipant,
    muteAll,
    lowerAllHands,
    sendMessage,
    createPoll,
    votePoll,
    askQuestion,
    upvoteQuestion,
    removeParticipant,
    endMeeting
  } = useWebRTC(roomCode, userName, isAdmin, onLeave);

  const handleShare = () => {
    const url = window.location.href;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Scalability: If more than 6 participants, switch to a more optimized view
  const isLargeMeeting = participants.length > 6;

  // Grid layout optimization
  const getTileStyles = (count: number) => {
    if (count === 1) return "w-full max-w-5xl aspect-video";
    if (count === 2) return "w-full md:w-[calc(48%-16px)] aspect-video max-w-3xl";
    if (count === 3) return "w-[calc(48%-16px)] aspect-video max-w-2xl";
    if (count === 4) return "w-[calc(48%-16px)] aspect-video max-w-2xl";
    if (count <= 6) return "w-[calc(48%-16px)] md:w-[calc(32%-16px)] aspect-video max-w-xl";
    if (count <= 9) return "w-[calc(32%-16px)] aspect-video max-w-lg";
    return "w-[calc(32%-16px)] lg:w-[calc(24%-16px)] aspect-video max-w-md";
  };

  const activeSpeaker = useMemo(() => 
    participants.find(p => p.isScreenSharing) || 
    participants.find(p => p.isHandRaised) || 
    participants[0],
  [participants]);
  
  const otherParticipants = useMemo(() => 
    participants.filter(p => p.id !== activeSpeaker?.id),
  [participants, activeSpeaker]);

  return (
    <div className="h-screen bg-zinc-950 flex flex-col overflow-hidden text-zinc-100">
      {/* Header Info */}
      <div className="absolute top-3 left-4 z-20 flex items-center gap-2">
        <div className="bg-zinc-900/80 backdrop-blur-xl px-3 py-1.5 rounded-xl border border-zinc-800 flex items-center gap-3 shadow-2xl">
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse" />
            <span className="text-white text-xs font-bold tracking-tight">{roomCode}</span>
          </div>
          <div className="h-3 w-px bg-zinc-800" />
          <div className="flex items-center gap-1.5 text-zinc-400">
            <Users className="w-3.5 h-3.5" />
            <span className="text-[10px] font-bold">{participants.length}</span>
          </div>
          {isAdmin && (
            <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-orange-500/10 border border-orange-500/20 text-orange-500 text-[9px] font-black uppercase tracking-tighter">
              <ShieldCheck className="w-2.5 h-2.5" />
              Admin
            </div>
          )}
        </div>

        <button 
          onClick={handleShare}
          className="bg-zinc-900/80 backdrop-blur-xl px-3 py-1.5 rounded-xl border border-zinc-800 flex items-center gap-1.5 text-zinc-400 hover:text-white hover:bg-zinc-800 transition-all shadow-2xl group"
        >
          <Share2 className="w-3.5 h-3.5 group-hover:scale-110 transition-transform" />
          <span className="text-[10px] font-bold">{copied ? 'Copied!' : 'Copy Link'}</span>
        </button>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden relative">
        <div className="flex-1 p-4 md:p-6 flex items-center justify-center overflow-hidden">
          {isScreenSharing ? (
            <div className="w-full h-full flex flex-col lg:flex-row gap-6">
              <div className="flex-[4] relative">
                <ParticipantTile participant={activeSpeaker} isMain />
              </div>
              <div className="flex-1 flex flex-row lg:flex-col gap-4 overflow-x-auto lg:overflow-y-auto pb-4 lg:pb-0 scrollbar-hide">
                {otherParticipants.map(p => (
                  <div key={p.id} className="w-48 lg:w-full shrink-0">
                    <ParticipantTile participant={p} />
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-4 w-full h-full max-w-7xl mx-auto justify-center items-center content-center overflow-y-auto scrollbar-hide py-8 px-4">
              {participants.map(p => (
                <div 
                  key={p.id} 
                  className={cn(
                    "transition-all duration-500 ease-in-out shrink-0 flex items-center justify-center",
                    getTileStyles(participants.length)
                  )}
                >
                  <ParticipantTile participant={p} />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Sidebar Integration */}
        <Sidebar
          isOpen={sidebarType !== null}
          type={sidebarType || 'chat'}
          onClose={() => setSidebarType(null)}
          participants={participants}
          messages={messages}
          polls={polls}
          questions={questions}
          onSendMessage={sendMessage}
          onMuteParticipant={muteParticipant}
          onMuteAll={muteAll}
          onLowerAllHands={lowerAllHands}
          onRemoveParticipant={removeParticipant}
          onCreatePoll={createPoll}
          onVotePoll={votePoll}
          onAskQuestion={askQuestion}
          onUpvoteQuestion={upvoteQuestion}
          isHost={isAdmin}
        />
      </div>

      {/* Control Bar */}
      <ControlBar
        isMuted={isMuted}
        isCameraOff={isCameraOff}
        isScreenSharing={isScreenSharing}
        isHandRaised={isHandRaised}
        isChatOpen={sidebarType === 'chat'}
        isParticipantsOpen={sidebarType === 'participants'}
        isPollsOpen={sidebarType === 'polls'}
        isQAOpen={sidebarType === 'qa'}
        onToggleMic={toggleMic}
        onToggleCamera={toggleCamera}
        onToggleScreenShare={toggleScreenShare}
        onToggleHandRaise={toggleHandRaise}
        onToggleChat={() => setSidebarType(sidebarType === 'chat' ? null : 'chat')}
        onToggleParticipants={() => setSidebarType(sidebarType === 'participants' ? null : 'participants')}
        onTogglePolls={() => setSidebarType(sidebarType === 'polls' ? null : 'polls')}
        onToggleQA={() => setSidebarType(sidebarType === 'qa' ? null : 'qa')}
        onLeave={onLeave}
        onEndMeeting={endMeeting}
        participantCount={participants.length}
        isAdmin={isAdmin}
      />
    </div>
  );
};
