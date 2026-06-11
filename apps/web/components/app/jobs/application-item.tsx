import type { JobApplication } from '@mohandishub/shared';

type ApplicationItemProps = {
  app: JobApplication;
  onAccept?: (appId: string) => void;
  onReject?: (appId: string) => void;
  children?: React.ReactNode;
};

export const ApplicationItem = ({ app, onAccept, onReject, children }: ApplicationItemProps) => {
  // Mocking badges since we don't have this data in JobApplication yet
  const isVerified = true;
  const isTopRated = Math.random() > 0.5;

  return (
    <li
      style={{
        marginBottom: '1rem',
        padding: '1rem',
        background: '#f9f9f9',
        borderRadius: '8px',
        border: '1px solid #eee',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '0.5rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <strong>{app.expertName || app.expertId}</strong>
          {isVerified && (
            <span
              title="Verified"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '16px',
                height: '16px',
                background: '#10b981',
                borderRadius: '50%',
                color: '#fff',
              }}
            >
              <svg
                width="10"
                height="10"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
            </span>
          )}
          {isTopRated && (
            <span
              title="Top Rated"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '16px',
                height: '16px',
                background: '#f59e0b',
                borderRadius: '50%',
                color: '#fff',
              }}
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
              </svg>
            </span>
          )}
        </div>
        <span className={`badge badge--${app.status}`}>{app.status}</span>
      </div>
      <p style={{ fontSize: '0.95rem', color: '#555', marginBottom: '1rem' }}>{app.coverLetter}</p>

      {app.status === 'pending' && (
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {onAccept && (
            <button
              className="dashboard-primary-btn dashboard-primary-btn--small"
              onClick={() => onAccept(app.id)}
            >
              Accept
            </button>
          )}
          {onReject && (
            <button
              className="dashboard-btn dashboard-btn--secondary dashboard-btn--small"
              onClick={() => onReject(app.id)}
            >
              Reject
            </button>
          )}
        </div>
      )}
      {children}
    </li>
  );
};
