'use client';

import { createContext, useContext, useState, useCallback } from 'react';

type Toast = {
  id: string;
  title: string;
  message: string;
};

type ToastContextType = {
  addToast: (title: string, message: string) => void;
};

const ToastContext = createContext<ToastContextType | null>(null);

export const ToastProvider = ({ children }: { children: React.ReactNode }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((title: string, message: string) => {
    const id = Math.random().toString(36).substr(2, 9);
    setToasts((prev) => [...prev, { id, title, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 5000);
  }, []);

  return (
    <ToastContext.Provider value={{ addToast }}>
      {children}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        style={{
          position: 'fixed',
          bottom: '20px',
          insetInlineEnd: '20px',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
          zIndex: 9999,
        }}
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            style={{
              background: '#333',
              color: '#fff',
              padding: '12px 20px',
              borderRadius: '8px',
              minWidth: '250px',
              boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
              animation: 'slideIn 0.3s ease-out',
            }}
          >
            <strong style={{ display: 'block', fontSize: '14px', marginBottom: '4px' }}>
              {t.title}
            </strong>
            <span style={{ fontSize: '13px', opacity: 0.9 }}>{t.message}</span>
          </div>
        ))}
      </div>
      <style
        dangerouslySetInnerHTML={{
          __html: `
        @keyframes slideIn {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
      `,
        }}
      />
    </ToastContext.Provider>
  );
};

export const useToast = () => {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
};

/** Use when component may render outside ToastProvider; falls back to no-op or console. */
export const useToastOptional = (): ToastContextType => {
  const ctx = useContext(ToastContext);
  return ctx ?? { addToast: () => {} };
};
