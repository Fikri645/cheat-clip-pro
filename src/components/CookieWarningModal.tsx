import React, { useState } from 'react';
import { useLanguage } from '../locales';

export interface CookieWarningModalProps {
  isOpen: boolean;
  actionType: 'render' | 'download';
  onClose: () => void;
  onProceedAnyway: () => void;
  onOpenCookiesModal: () => void;
}

export const CookieWarningModal: React.FC<CookieWarningModalProps> = ({
  isOpen,
  actionType,
  onClose,
  onProceedAnyway,
  onOpenCookiesModal,
}) => {
  const { t } = useLanguage();
  const [dontShowAgain, setDontShowAgain] = useState<boolean>(false);

  if (!isOpen) return null;

  const handleProceed = () => {
    if (dontShowAgain) {
      try {
        sessionStorage.setItem('cheatclip_skip_cookie_warning', 'true');
      } catch (e) {
        console.warn('Failed to save cookie warning preference to sessionStorage:', e);
      }
    }
    onProceedAnyway();
  };

  const handleOpenSetup = () => {
    if (dontShowAgain) {
      try {
        sessionStorage.setItem('cheatclip_skip_cookie_warning', 'true');
      } catch (e) {
        console.warn('Failed to save cookie warning preference to sessionStorage:', e);
      }
    }
    onOpenCookiesModal();
  };

  const isRender = actionType === 'render';

  return (
    <div className="custom-confirm-modal-overlay" style={{ zIndex: 10002 }} onClick={onClose}>
      <div
        className="custom-confirm-modal-card cookie-warning-modal-card"
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: '520px',
          padding: '2rem 2.2rem',
          background: 'linear-gradient(155deg, #181d28 0%, #0d121c 100%)',
          border: '1px solid rgba(245, 158, 11, 0.35)',
          boxShadow: '0 25px 70px rgba(0, 0, 0, 0.85), 0 0 45px rgba(245, 158, 11, 0.18)',
        }}
      >
        {/* Warning Icon Badge */}
        <div
          style={{
            width: '64px',
            height: '64px',
            borderRadius: '50%',
            background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.22) 0%, rgba(217, 119, 6, 0.1) 100%)',
            border: '1px solid rgba(245, 158, 11, 0.5)',
            boxShadow: '0 0 25px rgba(245, 158, 11, 0.3)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '2rem',
            marginBottom: '1.1rem',
          }}
        >
          🍪
        </div>

        {/* Modal Title */}
        <h3
          className="confirm-modal-title"
          style={{
            fontSize: '1.25rem',
            fontWeight: 800,
            color: '#ffffff',
            marginBottom: '0.65rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.45rem',
          }}
        >
          <span style={{ color: '#f59e0b' }}>⚠️</span> {t.cookieWarning.modalTitle}
        </h3>

        {/* Description */}
        <p
          className="confirm-modal-desc"
          style={{
            fontSize: '0.86rem',
            color: 'var(--text-secondary, #94a3b8)',
            lineHeight: 1.55,
            marginBottom: '1.25rem',
            textAlign: 'center',
          }}
        >
          {isRender
            ? t.cookieWarning.renderWarningDesc
            : t.cookieWarning.downloadWarningDesc}
        </p>

        {/* Quality Comparison Box */}
        <div
          style={{
            width: '100%',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.65rem',
            marginBottom: '1.35rem',
            padding: '0.9rem 1.1rem',
            borderRadius: '12px',
            background: 'rgba(0, 0, 0, 0.35)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            textAlign: 'left',
          }}
        >
          {/* Without Cookies */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.65rem' }}>
            <span style={{ fontSize: '1rem', flexShrink: 0, marginTop: '2px' }}>❌</span>
            <div>
              <strong style={{ fontSize: '0.8rem', color: '#f87171', display: 'block' }}>
                {t.cookieWarning.withoutCookiesTitle}
              </strong>
              <span style={{ fontSize: '0.74rem', color: '#cbd5e1' }}>
                {t.cookieWarning.withoutCookiesDesc}
              </span>
            </div>
          </div>

          <div style={{ height: '1px', background: 'rgba(255, 255, 255, 0.06)', margin: '0.15rem 0' }} />

          {/* With Cookies */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.65rem' }}>
            <span style={{ fontSize: '1rem', flexShrink: 0, marginTop: '2px' }}>✨</span>
            <div>
              <strong style={{ fontSize: '0.8rem', color: '#34d399', display: 'block' }}>
                {t.cookieWarning.withCookiesTitle}
              </strong>
              <span style={{ fontSize: '0.74rem', color: '#cbd5e1' }}>
                {t.cookieWarning.withCookiesDesc}
              </span>
            </div>
          </div>
        </div>

        {/* Don't show again checkbox */}
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            fontSize: '0.76rem',
            color: 'var(--text-secondary, #94a3b8)',
            cursor: 'pointer',
            marginBottom: '1.4rem',
            userSelect: 'none',
          }}
        >
          <input
            type="checkbox"
            checked={dontShowAgain}
            onChange={(e) => setDontShowAgain(e.target.checked)}
            style={{
              cursor: 'pointer',
              accentColor: '#10b981',
              width: '14px',
              height: '14px',
            }}
          />
          <span>{t.cookieWarning.dontShowAgainSession}</span>
        </label>

        {/* Action Buttons */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '0.65rem',
            width: '100%',
          }}
        >
          {/* Primary Action: Setup Cookies Now */}
          <button
            type="button"
            onClick={handleOpenSetup}
            style={{
              width: '100%',
              padding: '0.8rem 1.2rem',
              borderRadius: '9px',
              border: '1px solid rgba(16, 185, 129, 0.5)',
              background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
              color: '#ffffff',
              fontWeight: 700,
              fontSize: '0.88rem',
              cursor: 'pointer',
              boxShadow: '0 4px 18px rgba(16, 185, 129, 0.4)',
              transition: 'all 0.15s ease',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.5rem',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.filter = 'brightness(1.1)';
              (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-1px)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.filter = 'none';
              (e.currentTarget as HTMLButtonElement).style.transform = 'none';
            }}
          >
            {t.cookieWarning.setupCookiesBtn}
          </button>

          {/* Secondary Action: Proceed Anyway */}
          <div style={{ display: 'flex', gap: '0.6rem', width: '100%' }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                flex: 1,
                padding: '0.65rem 1rem',
                borderRadius: '8px',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                background: 'rgba(255, 255, 255, 0.05)',
                color: 'var(--text-secondary, #94a3b8)',
                fontWeight: 600,
                fontSize: '0.82rem',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255, 255, 255, 0.1)';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255, 255, 255, 0.05)';
              }}
            >
              {t.cookieWarning.cancelBtn}
            </button>

            <button
              type="button"
              onClick={handleProceed}
              style={{
                flex: 1.4,
                padding: '0.65rem 1rem',
                borderRadius: '8px',
                border: '1px solid rgba(245, 158, 11, 0.4)',
                background: 'rgba(245, 158, 11, 0.12)',
                color: '#fbbf24',
                fontWeight: 600,
                fontSize: '0.82rem',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background = 'rgba(245, 158, 11, 0.2)';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background = 'rgba(245, 158, 11, 0.12)';
              }}
            >
              {t.cookieWarning.proceedAnywayBtn}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
