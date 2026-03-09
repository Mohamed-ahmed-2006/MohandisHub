import pkg from 'agora-access-token';
const { RtcRole, RtcTokenBuilder } = pkg;

export function buildAgoraRtcToken(params: {
  appId: string;
  appCertificate: string;
  channelName: string;
  uid: number;
  expiresInSeconds?: number;
}): string {
  const expiresInSeconds = params.expiresInSeconds ?? 3600;
  const now = Math.floor(Date.now() / 1000);
  const privilegeExpiredTs = now + expiresInSeconds;

  return RtcTokenBuilder.buildTokenWithUid(
    params.appId,
    params.appCertificate,
    params.channelName,
    params.uid,
    RtcRole.PUBLISHER,
    privilegeExpiredTs,
  );
}
