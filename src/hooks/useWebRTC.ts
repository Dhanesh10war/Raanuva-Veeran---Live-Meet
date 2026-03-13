import { useState, useEffect, useCallback, useRef } from 'react';
import { Participant, ChatMessage, Poll, Question } from '../types';

export const useWebRTC = (room: string, userName: string, isAdmin: boolean = false, onMeetingEnd?: () => void) => {
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [polls, setPolls] = useState<Poll[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isHandRaised, setIsHandRaised] = useState(false);
  const [isHost, setIsHost] = useState(isAdmin);
  const [speakingParticipants, setSpeakingParticipants] = useState<Set<string>>(new Set());

  const socketRef = useRef<WebSocket | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peerConnections = useRef<Map<string, RTCPeerConnection>>(new Map());
  const userId = useRef(Math.random().toString(36).substr(2, 9));
  const onMeetingEndRef = useRef(onMeetingEnd);

  useEffect(() => {
    onMeetingEndRef.current = onMeetingEnd;
  }, [onMeetingEnd]);

  useEffect(() => {
    setParticipants(prev => {
      let changed = false;
      const next = prev.map(p => {
        const isSpeaking = speakingParticipants.has(p.id);
        if (p.isSpeaking !== isSpeaking) {
          changed = true;
          return { ...p, isSpeaking };
        }
        return p;
      });
      return changed ? next : prev;
    });
  }, [speakingParticipants]);

  const initializeLocalStream = async () => {
    try {
      // Students don't need to initialize camera/mic immediately in a 100+ classroom
      // unless they are the Admin or have been "called on"
      if (!isAdmin && participants.length > 10) {
        console.log("Joined as viewer in large classroom");
        return null;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 360 },
          frameRate: { ideal: 15 }
        },
        audio: true
      });
      localStreamRef.current = stream;
      setParticipants(prev => {
        const local = {
          id: userId.current,
          name: userName + (isAdmin ? ' (Admin)' : ''),
          stream: stream,
          isMuted: false,
          isCameraOff: false,
          isScreenSharing: false,
          isHandRaised: false,
          isLocal: true,
          isHost: isAdmin
        };
        const others = prev.filter(p => !p.isLocal);
        return [local, ...others];
      });
      return stream;
    } catch (error) {
      console.error("Error accessing media devices:", error);
      return null;
    }
  };

  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${protocol}//${window.location.host}`);
    socketRef.current = socket;

    socket.onopen = async () => {
      // In a 100+ classroom, only Admin starts publishing immediately
      const stream = isAdmin ? await initializeLocalStream() : null;
      
      socket.send(JSON.stringify({
        type: 'join',
        room,
        userId: userId.current,
        name: userName + (isAdmin ? ' (Admin)' : ''),
        isAdmin
      }));

      if (stream) {
        // Setup volume detection for Admin
        const audioContext = new AudioContext();
        const source = audioContext.createMediaStreamSource(stream);
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        
        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        let lastSpeaking = false;

        const checkVolume = () => {
          if (socket.readyState !== WebSocket.OPEN) return;
          
          analyser.getByteFrequencyData(dataArray);
          const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
          const isSpeaking = average > 30;

          if (isSpeaking !== lastSpeaking) {
            lastSpeaking = isSpeaking;
            socket.send(JSON.stringify({
              type: 'speaking',
              room,
              userId: userId.current,
              isSpeaking
            }));
            setSpeakingParticipants(prev => {
              const next = new Set(prev);
              if (isSpeaking) next.add(userId.current);
              else next.delete(userId.current);
              return next;
            });
          }
        };
        
        const volumeInterval = setInterval(checkVolume, 200);
        return () => clearInterval(volumeInterval);
      }

      // Keep-alive heartbeat
      const heartbeat = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'ping' }));
        }
      }, 30000);

      return () => clearInterval(heartbeat);
    };

    socket.onmessage = async (event) => {
      const message = JSON.parse(event.data);

      switch (message.type) {
        case 'participants-list':
          setParticipants(prev => {
            const local = prev.find(p => p.isLocal);
            const others = message.participants.map((p: any) => ({
              id: p.userId,
              name: p.name,
              isMuted: false,
              isCameraOff: false,
              isScreenSharing: false,
              isHost: p.isAdmin
            }));
            return local ? [local, ...others] : others;
          });
          break;
        case 'user-joined':
          setParticipants(prev => {
            if (prev.find(p => p.id === message.userId)) return prev;
            return [...prev, {
              id: message.userId,
              name: message.name,
              isMuted: false,
              isCameraOff: false,
              isScreenSharing: false,
              isHost: message.isAdmin
            }];
          });
          createPeerConnection(message.userId, true);
          break;
        case 'offer':
          handleOffer(message.userId, message.offer);
          break;
        case 'answer':
          handleAnswer(message.userId, message.answer);
          break;
        case 'candidate':
          handleCandidate(message.userId, message.candidate);
          break;
        case 'user-left':
          removeParticipant(message.userId);
          break;
        case 'chat':
          setMessages(prev => [...prev, message.message]);
          break;
        case 'toggle-hand':
          setParticipants(prev => prev.map(p => 
            p.id === message.userId ? { ...p, isHandRaised: message.isHandRaised } : p
          ));
          break;
        case 'toggle-screen-share':
          setParticipants(prev => prev.map(p => 
            p.id === message.userId ? { ...p, isScreenSharing: message.isScreenSharing } : p
          ));
          break;
        case 'toggle-mic':
          setParticipants(prev => prev.map(p => 
            p.id === message.userId ? { ...p, isMuted: message.isMuted } : p
          ));
          break;
        case 'toggle-camera':
          setParticipants(prev => prev.map(p => 
            p.id === message.userId ? { ...p, isCameraOff: message.isCameraOff } : p
          ));
          break;
        case 'speaking':
          setSpeakingParticipants(prev => {
            const next = new Set(prev);
            if (message.isSpeaking) next.add(message.userId);
            else next.delete(message.userId);
            return next;
          });
          break;
        case 'remote-mute':
          if (message.targetUserId === userId.current) {
            if (!isMuted) toggleMic();
          }
          break;
        case 'mute-all':
          if (!isAdmin && !isMuted) {
            toggleMic();
          }
          break;
        case 'lower-all-hands':
          if (isHandRaised) {
            toggleHandRaise();
          }
          break;
        case 'poll-created':
          setPolls(prev => [...prev, message.poll]);
          break;
        case 'poll-voted':
          setPolls(prev => prev.map(p => {
            if (p.id === message.pollId) {
              return {
                ...p,
                options: p.options.map(o => 
                  o.id === message.optionId ? { ...o, votes: o.votes + 1 } : o
                )
              };
            }
            return p;
          }));
          break;
        case 'question-asked':
          setQuestions(prev => [...prev, message.question]);
          break;
        case "question-upvoted":
          setQuestions(prev => prev.map(q => 
            q.id === message.questionId ? { ...q, upvotes: q.upvotes + 1 } : q
          ).sort((a, b) => b.upvotes - a.upvotes));
          break;
        case 'end-meeting':
          if (onMeetingEndRef.current) onMeetingEndRef.current();
          break;
      }
    };

    return () => {
      socket.close();
      localStreamRef.current?.getTracks().forEach(track => track.stop());
      peerConnections.current.forEach(pc => pc.close());
    };
  }, [room, userName]);

  const createPeerConnection = (targetUserId: string, isOffer: boolean) => {
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
      ]
    });

    peerConnections.current.set(targetUserId, pc);

    localStreamRef.current?.getTracks().forEach(track => {
      pc.addTrack(track, localStreamRef.current!);
    });

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socketRef.current?.send(JSON.stringify({
          type: 'candidate',
          candidate: event.candidate,
          userId: userId.current,
          targetUserId
        }));
      }
    };

    pc.ontrack = (event) => {
      console.log(`Received remote track from ${targetUserId}:`, event.track.kind);
      
      setParticipants(prev => {
        const existing = prev.find(p => p.id === targetUserId);
        
        // Use existing stream or create a new one if it doesn't exist
        const remoteStream = existing?.stream || new MediaStream();
        
        // Add the new track to the stream
        if (!remoteStream.getTracks().find(t => t.id === event.track.id)) {
          remoteStream.addTrack(event.track);
        }

        if (existing) {
          return prev.map(p => p.id === targetUserId ? { ...p, stream: new MediaStream(remoteStream.getTracks()) } : p);
        }

        return prev;
      });
    };

    pc.oniceconnectionstatechange = () => {
      console.log(`ICE Connection State with ${targetUserId}: ${pc.iceConnectionState}`);
      if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') {
        console.warn("WebRTC connection failed. This is often due to restrictive NATs/Firewalls.");
      }
    };

    if (isOffer) {
      pc.createOffer().then(offer => {
        pc.setLocalDescription(offer);
        socketRef.current?.send(JSON.stringify({
          type: 'offer',
          offer,
          userId: userId.current,
          targetUserId
        }));
      });
    }

    return pc;
  };

  const handleOffer = async (targetUserId: string, offer: RTCSessionDescriptionInit) => {
    const pc = createPeerConnection(targetUserId, false);
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socketRef.current?.send(JSON.stringify({
      type: 'answer',
      answer,
      userId: userId.current,
      targetUserId
    }));
  };

  const handleAnswer = async (targetUserId: string, answer: RTCSessionDescriptionInit) => {
    const pc = peerConnections.current.get(targetUserId);
    if (pc) {
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
    }
  };

  const handleCandidate = async (targetUserId: string, candidate: RTCIceCandidateInit) => {
    const pc = peerConnections.current.get(targetUserId);
    if (pc) {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    }
  };

  const removeParticipant = (id: string) => {
    peerConnections.current.get(id)?.close();
    peerConnections.current.delete(id);
    setParticipants(prev => prev.filter(p => p.id !== id));
  };

  const toggleMic = () => {
    if (localStreamRef.current) {
      const newState = !isMuted;
      localStreamRef.current.getAudioTracks().forEach(track => {
        track.enabled = !newState;
      });
      setIsMuted(newState);
      socketRef.current?.send(JSON.stringify({
        type: 'toggle-mic',
        room,
        userId: userId.current,
        isMuted: newState
      }));
      setParticipants(prev => prev.map(p => 
        p.id === userId.current ? { ...p, isMuted: newState } : p
      ));
    }
  };

  const toggleCamera = () => {
    if (localStreamRef.current) {
      const newState = !isCameraOff;
      localStreamRef.current.getVideoTracks().forEach(track => {
        track.enabled = !newState;
      });
      setIsCameraOff(newState);
      socketRef.current?.send(JSON.stringify({
        type: 'toggle-camera',
        room,
        userId: userId.current,
        isCameraOff: newState
      }));
      setParticipants(prev => prev.map(p => 
        p.id === userId.current ? { ...p, isCameraOff: newState } : p
      ));
    }
  };

  const toggleScreenShare = async () => {
    if (!isScreenSharing) {
      try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        const screenTrack = screenStream.getVideoTracks()[0];
        
        peerConnections.current.forEach(pc => {
          const sender = pc.getSenders().find(s => s.track?.kind === 'video');
          if (sender) sender.replaceTrack(screenTrack);
        });

        screenTrack.onended = () => {
          stopScreenShare();
        };

        setIsScreenSharing(true);
        socketRef.current?.send(JSON.stringify({
          type: 'toggle-screen-share',
          room,
          userId: userId.current,
          isScreenSharing: true
        }));
        setParticipants(prev => prev.map(p => 
          p.id === userId.current ? { ...p, isScreenSharing: true } : p
        ));
      } catch (error) {
        console.error("Error sharing screen:", error);
      }
    } else {
      stopScreenShare();
    }
  };

  const stopScreenShare = () => {
    const videoTrack = localStreamRef.current?.getVideoTracks()[0];
    peerConnections.current.forEach(pc => {
      const sender = pc.getSenders().find(s => s.track?.kind === 'video');
      if (sender && videoTrack) sender.replaceTrack(videoTrack);
    });
    setIsScreenSharing(false);
    socketRef.current?.send(JSON.stringify({
      type: 'toggle-screen-share',
      room,
      userId: userId.current,
      isScreenSharing: false
    }));
    setParticipants(prev => prev.map(p => 
      p.id === userId.current ? { ...p, isScreenSharing: false } : p
    ));
  };

  const sendMessage = (text: string) => {
    const message: ChatMessage = {
      id: Math.random().toString(36).substr(2, 9),
      sender: userName,
      text,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    socketRef.current?.send(JSON.stringify({
      type: 'chat',
      room,
      message
    }));
  };

  const toggleHandRaise = () => {
    const newState = !isHandRaised;
    setIsHandRaised(newState);
    socketRef.current?.send(JSON.stringify({
      type: 'toggle-hand',
      room,
      userId: userId.current,
      isHandRaised: newState
    }));
    setParticipants(prev => prev.map(p => 
      p.id === userId.current ? { ...p, isHandRaised: newState } : p
    ));
  };

  const muteParticipant = (targetUserId: string) => {
    if (!isAdmin) return;
    socketRef.current?.send(JSON.stringify({
      type: 'remote-mute',
      room,
      targetUserId
    }));
  };

  const muteAll = () => {
    if (!isAdmin) return;
    socketRef.current?.send(JSON.stringify({
      type: 'mute-all',
      room
    }));
  };

  const lowerAllHands = () => {
    if (!isAdmin) return;
    socketRef.current?.send(JSON.stringify({
      type: 'lower-all-hands',
      room
    }));
  };

  const createPoll = (question: string, options: string[]) => {
    if (!isAdmin) return;
    const poll: Poll = {
      id: Math.random().toString(36).substr(2, 9),
      question,
      options: options.map(o => ({ id: Math.random().toString(36).substr(2, 9), text: o, votes: 0 })),
      isOpen: true,
      creatorId: userId.current
    };
    socketRef.current?.send(JSON.stringify({
      type: 'poll-created',
      room,
      poll
    }));
  };

  const votePoll = (pollId: string, optionId: string) => {
    socketRef.current?.send(JSON.stringify({
      type: 'poll-voted',
      room,
      pollId,
      optionId
    }));
  };

  const askQuestion = (text: string) => {
    const question: Question = {
      id: Math.random().toString(36).substr(2, 9),
      sender: userName,
      text,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      upvotes: 0,
      isAnswered: false
    };
    socketRef.current?.send(JSON.stringify({
      type: 'question-asked',
      room,
      question
    }));
  };

  const upvoteQuestion = (questionId: string) => {
    socketRef.current?.send(JSON.stringify({
      type: 'question-upvoted',
      room,
      questionId
    }));
  };
  
  const endMeeting = () => {
    if (!isAdmin) return;
    socketRef.current?.send(JSON.stringify({
      type: 'end-meeting',
      room
    }));
    // Also leave locally immediately
    if (onMeetingEndRef.current) onMeetingEndRef.current();
  };

  return {
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
  };
};
