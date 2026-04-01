'use client';

import type { Reservation } from '@mohandishub/shared';
import type {
  IAgoraRTCClient,
  ICameraVideoTrack,
  ILocalTrack,
  IMicrophoneAudioTrack,
} from 'agora-rtc-sdk-ng';
import { useCallback, useEffect, useRef, useState } from 'react';

import { isApiClientError } from '@/lib/auth/client';
import { reservationsApiClient } from '@/lib/reservations/client';

const withTimeout = <T,>(promise: Promise<T>, ms: number, message: string): Promise<T> => {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  });
};

type Props = {
  open: boolean;
  reservation: Reservation | null;
  accessToken: string;
  onClose: () => void;
  onEnded?: () => void;
};

export const OnlineCallModal = ({ open, reservation, accessToken, onClose, onEnded }: Props) => {
  const [loading, setLoading] = useState(false);
  const [ending, setEnding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [micMuted, setMicMuted] = useState(false);
  const [camMuted, setCamMuted] = useState(false);
  const [connected, setConnected] = useState(false);
  const [callSeconds, setCallSeconds] = useState(0);

  const localVideoRef = useRef<HTMLDivElement | null>(null);
  const remoteVideoRef = useRef<HTMLDivElement | null>(null);

  const clientRef = useRef<IAgoraRTCClient | null>(null);
  const micTrackRef = useRef<IMicrophoneAudioTrack | null>(null);
  const camTrackRef = useRef<ICameraVideoTrack | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reservationIdRef = useRef<string | null>(null);
  const cleanupPromiseRef = useRef<Promise<void> | null>(null);
  const renewPromiseRef = useRef<Promise<void> | null>(null);
  const renewFailureCountRef = useRef(0);
  const callTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /** True after local publish succeeds; used to ignore late WebRTC failures during teardown. */
  const callEstablishedRef = useRef(false);

  const cleanup = useCallback(async (notifyDisconnect: boolean) => {
    if (cleanupPromiseRef.current) {
      await cleanupPromiseRef.current;
      return;
    }

    cleanupPromiseRef.current = (async () => {
    const reservationId = reservationIdRef.current;
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
    if (callTimerRef.current) {
      clearInterval(callTimerRef.current);
      callTimerRef.current = null;
    }

    if (notifyDisconnect && reservationId) {
      await reservationsApiClient.callHeartbeat(accessToken, reservationId, { connected: false }).catch(() => {});
    }

    micTrackRef.current?.stop();
    micTrackRef.current?.close();
    micTrackRef.current = null;

    camTrackRef.current?.stop();
    camTrackRef.current?.close();
    camTrackRef.current = null;

    if (clientRef.current) {
      await clientRef.current.leave().catch(() => {});
      clientRef.current.removeAllListeners();
      clientRef.current = null;
    }

    reservationIdRef.current = null;
    renewPromiseRef.current = null;
    renewFailureCountRef.current = 0;
    callEstablishedRef.current = false;
    setConnected(false);
    setMicMuted(false);
    setCamMuted(false);
    setCallSeconds(0);

    if (localVideoRef.current) localVideoRef.current.innerHTML = '';
    if (remoteVideoRef.current) remoteVideoRef.current.innerHTML = '';
    })();

    try {
      await cleanupPromiseRef.current;
    } finally {
      cleanupPromiseRef.current = null;
    }
  }, [accessToken]);

  useEffect(() => {
    if (!connected) return;
    callTimerRef.current = setInterval(() => {
      setCallSeconds((prev) => prev + 1);
    }, 1_000);
    return () => {
      if (callTimerRef.current) {
        clearInterval(callTimerRef.current);
        callTimerRef.current = null;
      }
    };
  }, [connected]);

  const renewAgoraToken = useCallback(async () => {
    const reservationId = reservationIdRef.current;
    const client = clientRef.current;
    if (!reservationId || !client) return;
    if (renewPromiseRef.current) {
      await renewPromiseRef.current;
      return;
    }

    renewPromiseRef.current = (async () => {
      try {
        const renewed = await reservationsApiClient.renewCallToken(accessToken, reservationId);
        await client.renewToken(renewed.token);
        renewFailureCountRef.current = 0;
        setError(null);
      } catch {
        renewFailureCountRef.current += 1;
        if (renewFailureCountRef.current >= 3) {
          await cleanup(true);
          setError('Call token renewal failed repeatedly. Please rejoin the call.');
        }
      } finally {
        renewPromiseRef.current = null;
      }
    })();

    await renewPromiseRef.current;
  }, [accessToken, cleanup]);

  useEffect(() => {
    if (!open || !reservation || reservation.mode !== 'online' || !reservation.onlineType) return;

    let mounted = true;

    const start = async () => {
      setLoading(true);
      setError(null);
      reservationIdRef.current = reservation.id;
      const mediaType = reservation.onlineType;
      if (!mediaType) {
        setLoading(false);
        return;
      }
      try {
        const join = await reservationsApiClient.joinCall(accessToken, reservation.id, {
          mediaType,
        });
        const { default: AgoraRTC } = await import('agora-rtc-sdk-ng');
        if (!mounted) return;

        const client = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });
        clientRef.current = client;

        client.on('peerconnection-state-change', (curState) => {
          if (!mounted || callEstablishedRef.current) return;
          if (curState === 'failed') {
            setError(
              'The call could not connect (network or firewall blocked WebRTC). Try another network or disable VPN.',
            );
            void cleanup(false);
          }
        });

        client.on('user-published', (user, userMediaType) => {
          void (async () => {
            await client.subscribe(user, userMediaType);
            if (userMediaType === 'video' && remoteVideoRef.current && user.videoTrack) {
              user.videoTrack.play(remoteVideoRef.current);
            }
            if (userMediaType === 'audio' && user.audioTrack) {
              user.audioTrack.play();
            }
          })();
        });

        client.on('user-unpublished', (user, mediaType) => {
          if (mediaType === 'video') {
            user.videoTrack?.stop();
            if (remoteVideoRef.current) remoteVideoRef.current.innerHTML = '';
          }
        });
        client.on('token-privilege-will-expire', () => {
          void renewAgoraToken();
        });
        client.on('token-privilege-did-expire', () => {
          void renewAgoraToken();
        });

        await withTimeout(
          client.join(join.appId, join.channel, join.token, join.uid),
          45_000,
          'Timed out connecting to the call. Check your network, firewall, or VPN.',
        );

        let publishTracks: ILocalTrack[] = [];
        if (mediaType === 'video') {
          const tracks = await withTimeout(
            AgoraRTC.createMicrophoneAndCameraTracks(),
            60_000,
            'Camera or microphone access timed out. Allow permissions in your browser, then try again.',
          );
          micTrackRef.current = tracks[0];
          camTrackRef.current = tracks[1];
          publishTracks = [tracks[0], tracks[1]];
        } else {
          const micTrack: IMicrophoneAudioTrack = await withTimeout(
            AgoraRTC.createMicrophoneAudioTrack(),
            60_000,
            'Microphone access is required. Allow the browser prompt or site permission, then try again.',
          );
          micTrackRef.current = micTrack;
          camTrackRef.current = null;
          publishTracks = [micTrack];
        }

        if (mediaType === 'video' && localVideoRef.current && camTrackRef.current) {
          camTrackRef.current.play(localVideoRef.current);
        }
        await withTimeout(
          client.publish(publishTracks),
          30_000,
          'Timed out starting your media. Close the dialog and try again.',
        );
        callEstablishedRef.current = true;
        setConnected(true);

        heartbeatRef.current = setInterval(() => {
          void reservationsApiClient
            .callHeartbeat(accessToken, reservation.id, { connected: true })
            .catch(() => {});
        }, 10_000);
      } catch (e) {
        if (isApiClientError(e)) {
          if (e.code === 'AGORA_NOT_CONFIGURED' || e.code === 'AGORA_TOKEN_FAILED') {
            setError(
              e.code === 'AGORA_TOKEN_FAILED'
                ? e.message
                : 'Calls are not available right now (service not configured).',
            );
          } else {
            setError(e.message);
          }
        } else {
          setError(e instanceof Error ? e.message : 'Could not join call');
        }
        await cleanup(false);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    void start();

    return () => {
      mounted = false;
      void cleanup(false);
    };
  }, [accessToken, cleanup, open, renewAgoraToken, reservation]);

  const endCall = async () => {
    if (!reservation) return;
    setEnding(true);
    setError(null);
    try {
      await reservationsApiClient.endCall(accessToken, reservation.id, { action: 'end' });
      await cleanup(false);
      onEnded?.();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to end call');
    } finally {
      setEnding(false);
    }
  };

  const close = () => {
    void cleanup(true);
    onClose();
  };

  const toggleMic = async () => {
    if (!micTrackRef.current) return;
    const nextMuted = !micMuted;
    try {
      await micTrackRef.current.setEnabled(!nextMuted);
      setMicMuted(nextMuted);
    } catch {
      setError('Could not update microphone state.');
    }
  };

  const toggleCamera = async () => {
    if (reservation?.onlineType !== 'video' || !camTrackRef.current) return;
    const nextMuted = !camMuted;
    try {
      await camTrackRef.current.setEnabled(!nextMuted);
      setCamMuted(nextMuted);
    } catch {
      setError('Could not update camera state.');
    }
  };

  const formatCallDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  if (!open || !reservation) return null;

  return (
    <div className="plan-modal-overlay" onClick={close}>
      <div className="plan-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 840 }}>
        <h3 className="plan-modal-title">
          {reservation.onlineType === 'video' ? 'Video Call' : 'Voice Call'}
        </h3>
        <p style={{ marginTop: '-0.5rem', marginBottom: '0.75rem', color: '#6b7280', fontSize: '0.9rem' }}>
          {connected ? `Connected • ${formatCallDuration(callSeconds)}` : 'Connecting...'}
        </p>
        {error && <p className="dashboard-error">{error}</p>}
        {loading && <p className="dashboard-loading">Joining call...</p>}

        <div style={{ display: 'grid', gridTemplateColumns: reservation.onlineType === 'video' ? '1fr 1fr' : '1fr', gap: '0.75rem' }}>
          {reservation.onlineType === 'video' && (
            <div style={{ minHeight: 220, borderRadius: 8, border: '1px solid rgba(0,0,0,0.1)', overflow: 'hidden' }}>
              <div ref={localVideoRef} style={{ width: '100%', height: '100%' }} />
            </div>
          )}
          {reservation.onlineType === 'voice' ? (
            <div
              style={{
                minHeight: 220,
                borderRadius: 8,
                border: '1px solid rgba(0,0,0,0.1)',
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '1rem',
                background: 'rgba(0,0,0,0.02)',
              }}
            >
              <div ref={remoteVideoRef} style={{ width: '100%', flex: 1, minHeight: 80 }} />
              <p
                style={{
                  margin: '0.75rem 0 0',
                  fontSize: '0.875rem',
                  color: '#6b7280',
                  textAlign: 'center',
                  maxWidth: 320,
                }}
              >
                {connected
                  ? 'Voice only — you will hear the other person when they join. No video is shown for audio calls.'
                  : 'Voice call — allow microphone access when the browser asks.'}
              </p>
            </div>
          ) : (
            <div style={{ minHeight: 220, borderRadius: 8, border: '1px solid rgba(0,0,0,0.1)', overflow: 'hidden' }}>
              <div ref={remoteVideoRef} style={{ width: '100%', height: '100%' }} />
            </div>
          )}
        </div>

        <div className="dashboard-form-row" style={{ marginTop: '1rem', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button type="button" className="dashboard-btn dashboard-btn--secondary" onClick={() => void toggleMic()} disabled={!connected}>
            {micMuted ? 'Unmute Mic' : 'Mute Mic'}
          </button>
          {reservation.onlineType === 'video' && (
            <button
              type="button"
              className="dashboard-btn dashboard-btn--secondary"
              onClick={() => void toggleCamera()}
              disabled={!connected}
            >
              {camMuted ? 'Turn Camera On' : 'Turn Camera Off'}
            </button>
          )}
        </div>

        <div className="dashboard-form-row" style={{ marginTop: '1rem' }}>
          <button type="button" className="plan-modal-cancel" onClick={close}>
            Hang Up
          </button>
          <button
            type="button"
            className="dashboard-btn dashboard-btn--danger"
            onClick={() => void endCall()}
            disabled={ending}
          >
            {ending ? '...' : 'End Call'}
          </button>
        </div>
      </div>
    </div>
  );
};
