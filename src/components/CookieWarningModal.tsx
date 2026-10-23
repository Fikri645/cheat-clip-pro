import React, { useState } from 'react';
import { AlertTriangle, X, ShieldAlert, Check } from 'lucide-react';
import { useLanguage } from '../locales';
import styles from './CookieWarningModal.module.css';

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
    <div className={styles.overlay} onClick={onClose}>
      <div
        className={styles.card}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Warning Icon Badge */}
        <div className={styles.iconBadge} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <ShieldAlert size={28} color="var(--primary)" />
        </div>

        {/* Modal Title */}
        <h3 className={styles.title} style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', justifyContent: 'center' }}>
          <AlertTriangle size={18} color="var(--status-warning)" /> {t.cookieWarning.modalTitle}
        </h3>

        {/* Description */}
        <p className={styles.desc}>
          {isRender
            ? t.cookieWarning.renderWarningDesc
            : t.cookieWarning.downloadWarningDesc}
        </p>

        {/* Quality Comparison Box */}
        <div className={styles.compareBox}>
          {/* Without Cookies */}
          <div className={styles.compareRow}>
            <span style={{ fontSize: '1rem', flexShrink: 0, marginTop: '2px', color: 'var(--status-error)', display: 'flex', alignItems: 'center' }}>
              <X size={16} />
            </span>
            <div>
              <strong style={{ fontSize: '0.8rem', color: 'var(--status-error)', display: 'block' }}>
                {t.cookieWarning.withoutCookiesTitle}
              </strong>
              <span style={{ fontSize: '0.74rem', color: 'var(--text-secondary)' }}>
                {t.cookieWarning.withoutCookiesDesc}
              </span>
            </div>
          </div>

          <div className={styles.compareDivider} />

          {/* With Cookies */}
          <div className={styles.compareRow}>
            <span style={{ fontSize: '1rem', flexShrink: 0, marginTop: '2px', color: 'var(--status-success)', display: 'flex', alignItems: 'center' }}>
              <Check size={16} />
            </span>
            <div>
              <strong style={{ fontSize: '0.8rem', color: 'var(--status-success)', display: 'block' }}>
                {t.cookieWarning.withCookiesTitle}
              </strong>
              <span style={{ fontSize: '0.74rem', color: 'var(--text-secondary)' }}>
                {t.cookieWarning.withCookiesDesc}
              </span>
            </div>
          </div>
        </div>

        {/* Don't show again checkbox */}
        <label className={styles.checkboxLabel}>
          <input
            type="checkbox"
            checked={dontShowAgain}
            onChange={(e) => setDontShowAgain(e.target.checked)}
          />
          <span>{t.cookieWarning.dontShowAgainSession}</span>
        </label>

        {/* Action Buttons */}
        <div className={styles.actions}>
          {/* Primary Action: Setup Cookies Now */}
          <button
            type="button"
            onClick={handleOpenSetup}
            className={styles.setupBtn}
          >
            {t.cookieWarning.setupCookiesBtn}
          </button>

          {/* Secondary Action: Proceed Anyway */}
          <div className={styles.btnRow}>
            <button
              type="button"
              onClick={onClose}
              className={styles.cancelBtn}
            >
              {t.cookieWarning.cancelBtn}
            </button>

            <button
              type="button"
              onClick={handleProceed}
              className={styles.proceedBtn}
            >
              {t.cookieWarning.proceedAnywayBtn}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
