'use client';

import type { Reservation } from '@mohandishub/shared';
import { useEffect, useRef, useState } from 'react';

import { reservationsApiClient } from '@/lib/reservations/client';

type AgoraModule = typeof import('agora-rtc-sdk-ng');

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

  const clientRef = useRef<import('agora-rtc-sdk-ng').IAgoraRTCClient | null>(null);
  const micTrackRef = useRef<import('agora-rtc-sdk-ng').IMicrophoneAudioTrack | null>(null);
  const camTrackRef = useRef<import('agora-rtc-sdk-ng').ICameraVideoTrack | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reservationIdRef = useRef<string | null>(null);

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
        const AgoraRTC: AgoraModule['default'] = (await import('agora-rtc-sdk-ng')).default;
        if (!mounted) return;

        const client = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });
        clientRef.current = client;

        client.on('user-published', async (user, mediaType) => {
          await client.subscribe(user, mediaType);
          if (mediaType === 'video' && remoteVideoRef.current && user.videoTrack) {
            user.videoTrack.play(remoteVideoRef.current);
          }
          if (mediaType === 'audio' && user.audioTrack) {
            user.audioTrack.play();
          }
        });

        client.on('user-unpublished', (user, mediaType) => {
          if (mediaType === 'video') {
            user.videoTrack?.stop();
            if (remoteVideoRef.current) remoteVideoRef.current.innerHTML = '';
          }
        });

        await client.join(join.appId, join.channel, join.token, join.uid);

        const tracks = await AgoraRTC.createMicrophoneAndCameraTracks();
        micTrackRef.current = tracks[0];
        camTrackRef.current = mediaType === 'video' ? tracks[1] : null;

        if (mediaType === 'video' && localVideoRef.current && camTrackRef.current) {
          camTrackRef.current.play(localVideoRef.current);
        }

        const publishTracks: import('agora-rtc-sdk-ng').ILocalTrack[] = [tracks[0]];
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, reservation?.id]);

  const cleanup = async (notifyDisconnect: boolean) => {
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

    if (localVideoRef.current) localVideoRef.current.innerHTML = '';
    if (remoteVideoRef.current) remoteVideoRef.current.innerHTML = '';
  };

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
