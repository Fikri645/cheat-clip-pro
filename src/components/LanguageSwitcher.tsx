import React from 'react';
import { useLanguage } from '../locales';
import styles from './LanguageSwitcher.module.css';

export const LanguageSwitcher: React.FC = () => {
  const { language, setLanguage } = useLanguage();

  return (
    <div
      className={styles.switcher}
      role="group"
      aria-label="Language selection"
    >
      <button
        type="button"
        onClick={() => setLanguage('id')}
        className={`${styles.btn} ${language === 'id' ? styles.active : ''}`}
        title="Bahasa Indonesia"
      >
        [ID]
      </button>

      <button
        type="button"
        onClick={() => setLanguage('en')}
        className={`${styles.btn} ${language === 'en' ? styles.active : ''}`}
        title="English"
      >
        [EN]
      </button>
    </div>
  );
};
