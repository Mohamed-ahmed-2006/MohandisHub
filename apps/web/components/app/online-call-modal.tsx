'use client';

import type { Reservation } from '@mohandishub/shared';
import type {
  IAgoraRTCClient,
  ICameraVideoTrack,
  ILocalTrack,
  IMicrophoneAudioTrack,
} from 'agora-rtc-sdk-ng';
import { useCallback, useEffect, useRef, useState } from 'react';

import { reservationsApiClient } from '@/lib/reservations/client';

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

    if (localVideoRef.current) localVideoRef.current.innerHTML = '';
    if (remoteVideoRef.current) remoteVideoRef.current.innerHTML = '';
    })();

    try {
      await cleanupPromiseRef.current;
    } finally {
      cleanupPromiseRef.current = null;
    }
  }, [accessToken]);

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

        await client.join(join.appId, join.channel, join.token, join.uid);

        const tracks = await AgoraRTC.createMicrophoneAndCameraTracks();
        micTrackRef.current = tracks[0];
        camTrackRef.current = mediaType === 'video' ? tracks[1] : null;

        if (mediaType === 'video' && localVideoRef.current && camTrackRef.current) {
          camTrackRef.current.play(localVideoRef.current);
        }

        const publishTracks: ILocalTrack[] = [tracks[0]];
        if (mediaType === 'video' && tracks[1]) publishTracks.push(tracks[1]);
        await client.publish(publishTracks);

        heartbeatRef.current = setInterval(() => {
          void reservationsApiClient
            .callHeartbeat(accessToken, reservation.id, { connected: true })
            .catch(() => {});
        }, 10_000);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not join call');
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

  if (!open || !reservation) return null;

  return (
    <div className="plan-modal-overlay" onClick={close}>
      <div className="plan-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 840 }}>
        <h3 className="plan-modal-title">
          {reservation.onlineType === 'video' ? 'Video Call' : 'Voice Call'}
        </h3>
        {error && <p className="dashboard-error">{error}</p>}
        {loading && <p className="dashboard-loading">Joining call...</p>}

        <div style={{ display: 'grid', gridTemplateColumns: reservation.onlineType === 'video' ? '1fr 1fr' : '1fr', gap: '0.75rem' }}>
          {reservation.onlineType === 'video' && (
            <div style={{ minHeight: 220, borderRadius: 8, border: '1px solid rgba(0,0,0,0.1)', overflow: 'hidden' }}>
              <div ref={localVideoRef} style={{ width: '100%', height: '100%' }} />
            </div>
          )}
          <div style={{ minHeight: 220, borderRadius: 8, border: '1px solid rgba(0,0,0,0.1)', overflow: 'hidden' }}>
            <div ref={remoteVideoRef} style={{ width: '100%', height: '100%' }} />
          </div>
        </div>

        <div className="dashboard-form-row" style={{ marginTop: '1rem' }}>
          <button type="button" className="plan-modal-cancel" onClick={close}>
            Leave
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
